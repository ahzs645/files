import asyncio
import json
import os
import re
import signal
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import botright
import httpx
from bs4 import BeautifulSoup
from playwright.async_api import BrowserType


SEARCH_PATH = "/page.aspx/en/rfp/request_browse_public"
STOP_REQUESTED = False
ACTIVE_BROWSER = None
BOTRIGHT_USER_DATA_DIR = os.environ.get("BOTRIGHT_USER_DATA_DIR")
REMOVABLE_TEXT_SELECTORS = (
    "script, style, select, noscript, [type='hidden'], .iv-menu-container, .menu, "
    ".dropdown.icon, .dropdown-clear, .sr-only, .tooltip-field, button"
)
FIELD_SELECTORS = ".iv-form-row, .iv-field-row, [data-iv-role='field']"

_ORIGINAL_LAUNCH_PERSISTENT_CONTEXT = BrowserType.launch_persistent_context


# Botright hardcodes chromium_sandbox=True. Docker does not provide the Linux
# namespace support Chromium expects for that mode, so force it off here.
async def launch_persistent_context_without_sandbox(self, *args, **kwargs):
    if BOTRIGHT_USER_DATA_DIR:
        user_data_dir = str(Path(BOTRIGHT_USER_DATA_DIR).expanduser())
        Path(user_data_dir).mkdir(parents=True, exist_ok=True)

        if args:
            args = (user_data_dir, *args[1:])
        else:
            kwargs["user_data_dir"] = user_data_dir

    kwargs["chromium_sandbox"] = False
    return await _ORIGINAL_LAUNCH_PERSISTENT_CONTEXT(self, *args, **kwargs)


BrowserType.launch_persistent_context = launch_persistent_context_without_sandbox


class ScrapeCancelledError(Exception):
    pass


def now_ms() -> int:
    return int(time.time() * 1000)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_whitespace(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_date_to_iso(value: Optional[str]) -> Optional[str]:
    normalized = normalize_whitespace(value)
    if not normalized:
        return None

    patterns = [
        "%Y-%m-%d",
        "%b %d, %Y",
        "%B %d, %Y",
        "%m/%d/%Y",
        "%Y/%m/%d",
    ]

    for pattern in patterns:
        try:
            return datetime.strptime(normalized, pattern).date().isoformat()
        except ValueError:
            continue

    return normalized


def extract_process_id(value: Optional[str]) -> Optional[str]:
    match = re.search(r"process_manage_extranet/(\d+)", value or "")
    return match.group(1) if match else None


def to_absolute_url(base_url: str, value: Optional[str]) -> Optional[str]:
    normalized = normalize_whitespace(value)
    if not normalized:
        return None
    if normalized.startswith("http://") or normalized.startswith("https://"):
        return normalized
    return urljoin(base_url, normalized)


def dedupe_strings(values: List[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        normalized = normalize_whitespace(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            output.append(normalized)
    return output


def empty_counts() -> Dict[str, int]:
    return {
        "listingCount": 0,
        "detailCount": 0,
        "opportunityCount": 0,
        "addendaCount": 0,
        "attachmentCount": 0,
        "pageCount": 0,
        "failedDetails": 0,
    }


def chunk(values: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def build_search_text(listing: Dict[str, Any], detail: Optional[Dict[str, Any]]) -> str:
    detail_values = []
    if detail:
        for field in detail["detailFields"]:
            detail_values.extend([field["label"], field["value"]])

    return " ".join(
        dedupe_strings(
            [
                listing["opportunityId"],
                listing["description"],
                detail["descriptionText"] if detail else "",
                listing["issuedBy"] or "",
                listing["issuedFor"] or "",
                listing["type"],
                *listing["commodities"],
                *detail_values,
            ]
        )
    )


def merge_opportunity_record(listing: Dict[str, Any], detail: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        **listing,
        "descriptionText": detail["descriptionText"] if detail else listing["description"],
        "detailFields": detail["detailFields"] if detail else [],
        "addenda": detail["addenda"] if detail else [],
        "attachments": detail["attachments"] if detail else [],
        "searchText": build_search_text(listing, detail),
    }


def clean_text(element: Optional[Any]) -> str:
    if element is None:
        return ""

    clone = BeautifulSoup(str(element), "html.parser")
    for removable in clone.select(REMOVABLE_TEXT_SELECTORS):
        removable.decompose()
    return normalize_whitespace(clone.get_text(" ", strip=True))


def is_noise_value(value: str) -> bool:
    if "__ivCtrl[" in value:
        return True
    if re.search(r"(\d{1,2}:\d{2}:\d{2}\s*(AM|PM)\s*){4,}", value, re.IGNORECASE):
        return True
    if len(value) > 2000:
        return True
    if re.search(r"Delete (the|all) value", value, re.IGNORECASE):
        return True
    if re.search(r"See All(Delete|See all)", value, re.IGNORECASE):
        return True
    return False


def is_boilerplate_description(value: str) -> bool:
    return bool(re.search(r"log in|register with bc bid|prepare a submission", value, re.IGNORECASE))


def has_hidden_style(element: Any) -> bool:
    return bool(re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", element.get("style", ""), re.IGNORECASE))


def is_hidden_context(element: Any) -> bool:
    if element is None:
        return True

    current = element
    while current is not None and getattr(current, "name", None):
        classes = current.get("class", []) or []
        if (
            "hidden" in classes
            or current.has_attr("hidden")
            or current.get("aria-hidden") == "true"
            or has_hidden_style(current)
        ):
            return True
        current = current.parent

    return False


def get_table_headers(table: Any) -> List[str]:
    return [
        normalize_whitespace(header.get_text(" ", strip=True))
        for header in table.select("thead th, thead td, tr:first-child th")
        if normalize_whitespace(header.get_text(" ", strip=True))
    ]


def get_table_rows(table: Any) -> List[Any]:
    body_rows = table.select("tbody tr")
    if body_rows:
        return body_rows
    return table.select("tr")[1:]


def is_addenda_table(headers: List[str]) -> bool:
    first_header = headers[0] if headers else ""
    second_header = headers[1] if len(headers) > 1 else ""
    return bool(
        re.fullmatch(r"addend(?:a|um)?|amendments?", first_header, re.IGNORECASE)
        and re.search(r"\bdate\b", second_header, re.IGNORECASE)
    )


def is_amendment_history_table(headers: List[str]) -> bool:
    first_header = headers[0] if headers else ""
    second_header = headers[1] if len(headers) > 1 else ""
    third_header = headers[2] if len(headers) > 2 else ""
    return bool(
        re.fullmatch(r"#|amendment\s*#?", first_header, re.IGNORECASE)
        and re.search(r"\bamendment reason\b", second_header, re.IGNORECASE)
        and re.search(r"\bdate\b", third_header, re.IGNORECASE)
    )


def is_attachment_metadata(value: str) -> bool:
    if not value:
        return True
    if re.fullmatch(r"\d+", value):
        return True
    if re.fullmatch(r"yes|no|true|false", value, re.IGNORECASE):
        return True
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)?", value, re.IGNORECASE):
        return True
    if re.fullmatch(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}", value, re.IGNORECASE):
        return True
    return False


def file_name_from_url(url: str) -> Optional[str]:
    cleaned = (url or "").split("?", 1)[0]
    tail = cleaned.rsplit("/", 1)[-1] if "/" in cleaned else cleaned
    return normalize_whitespace(tail) or None


def extract_field_label(field: Any) -> str:
    label_element = field.select_one(".label-field, label")
    label = normalize_whitespace(label_element.get_text(" ", strip=True) if label_element else "")
    return re.sub(r"[:*]$", "", label)


def extract_field_value(field: Any) -> str:
    scopes = [
        field.select_one("[data-iv-role='controlWrapper']"),
        field.select_one(".control-wrapper"),
        field,
    ]

    for scope in [scope for scope in scopes if scope is not None]:
        input_values: List[str] = []
        for element in scope.select("input, textarea"):
            input_type = (element.get("type") or "").lower()
            if input_type in {"hidden", "checkbox", "radio"}:
                continue

            value = normalize_whitespace(element.get("value") or element.text or "")
            if value and not is_noise_value(value):
                input_values.append(value)

        clone = BeautifulSoup(str(scope), "html.parser")
        for removable in clone.select(".label-field, label, h1, h2, h3, h4, h5, h6, .default"):
            removable.decompose()
        for removable in clone.select("input, textarea"):
            removable.decompose()

        text_value = clean_text(clone)
        combined = normalize_whitespace(" ".join(dedupe_strings([*input_values, text_value])))
        if combined and not is_noise_value(combined):
            return combined

    return ""


def parse_browser_check_page(html: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    title = normalize_whitespace(soup.title.get_text(" ", strip=True) if soup.title else "")
    message = None

    for selector in [
        ".page-message-container.visible .iv-message-details",
        ".page-message-container .iv-message-details",
        "#body_x_lblMessage",
        ".maintitle",
        "h1",
    ]:
        element = soup.select_one(selector)
        text = normalize_whitespace(element.get_text(" ", strip=True) if element else "")
        if text:
            message = text
            break

    return {
        "isBrowserCheck": bool(re.search(r"browser check", title, re.IGNORECASE))
        or bool(message and re.search(r"browser check", message, re.IGNORECASE)),
        "message": message,
        "hasCaptcha": (
            bool(soup.select("script[src*='recaptcha']"))
            or soup.select_one("input[name='captcha_response']") is not None
            or "ivCaptcha" in html
        ),
    }


def parse_pager_value(soup: BeautifulSoup) -> Dict[str, int]:
    current_input = soup.select_one("input[name='hdnCurrentPageIndexbody_x_grid_grd'], #hdnCurrentPageIndexbody_x_grid_grd")
    current_hidden = normalize_whitespace(current_input.get("value") if current_input else "")
    current_page = int(current_hidden) + 1 if current_hidden.isdigit() else 1

    max_input = soup.select_one("input[name='maxpageindexbody_x_grid_grd'], #maxpageindexbody_x_grid_grd")
    max_hidden = normalize_whitespace(max_input.get("value") if max_input else "")
    hidden_max_page_index = int(max_hidden) if max_hidden.isdigit() else None

    page_numbers: List[int] = []
    for element in soup.select(".iv-grid-pager a, .iv-grid-pager span, .iv-grid-pager button, .iv.pager a, .iv.pager span, .iv.pager button"):
        aria_label = normalize_whitespace(element.get("aria-label"))
        label_match = re.search(r"page\s+(\d+)", aria_label, re.IGNORECASE)
        if label_match:
            page_numbers.append(int(label_match.group(1)))
            continue

        label = normalize_whitespace(element.get_text(" ", strip=True))
        if label.isdigit():
            page_numbers.append(int(label))

    numbers = page_numbers + [current_page, 1]
    if hidden_max_page_index is not None:
        numbers.append(hidden_max_page_index + 1)

    return {"currentPage": current_page, "totalPages": max(numbers)}


def parse_listing_page(html: str, base_url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    opportunities: List[Dict[str, Any]] = []

    for row in soup.select("#body_x_grid_grd tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 13:
            continue

        def get_text(index: int) -> str:
            return normalize_whitespace(cells[index].get_text(" ", strip=True))

        detail_link = None
        link = cells[2].select_one("a[href]") or cells[1].select_one("a[href]")
        if link:
            detail_link = link.get("href")

        detail_url = to_absolute_url(base_url, detail_link)
        process_id = extract_process_id(detail_url)
        opportunity_id = get_text(1)

        if not opportunity_id:
            continue

        opportunities.append(
            {
                "sourceKey": process_id or opportunity_id,
                "processId": process_id,
                "opportunityId": opportunity_id,
                "status": get_text(0),
                "description": get_text(2),
                "listingUrl": None,
                "detailUrl": detail_url,
                "commodities": dedupe_strings(re.split(r"[,;]+", get_text(3))),
                "type": get_text(4),
                "issueDate": parse_date_to_iso(get_text(5)),
                "closingDate": parse_date_to_iso(get_text(6)),
                "endsIn": get_text(7) or None,
                "amendments": int(get_text(8)) if get_text(8).isdigit() else 0,
                "lastUpdated": parse_date_to_iso(get_text(9)),
                "issuedBy": get_text(10) or None,
                "issuedFor": get_text(11) or None,
                "interestedVendorList": bool(re.search(r"yes", get_text(12), re.IGNORECASE)),
                "sourceCapturedAt": utc_now_iso(),
            }
        )

    pager = parse_pager_value(soup)
    return {"opportunities": opportunities, "currentPage": pager["currentPage"], "totalPages": pager["totalPages"]}


def read_field_rows(soup: BeautifulSoup) -> List[Dict[str, str]]:
    fields: Dict[str, str] = {}

    for row in soup.select(FIELD_SELECTORS):
        if is_hidden_context(row):
            continue

        label = extract_field_label(row)
        value = extract_field_value(row)

        if not label or not value or value == label or is_noise_value(value):
            continue

        if label not in fields:
            fields[label] = value

    return [{"label": label, "value": value} for label, value in fields.items()]


def read_grid_fields(soup: BeautifulSoup) -> List[Dict[str, str]]:
    fields: Dict[str, str] = {}

    for table in soup.select("table"):
        if is_hidden_context(table):
            continue

        headers = get_table_headers(table)
        if not headers or is_addenda_table(headers) or is_amendment_history_table(headers) or table.select_one("a[href*='download_public']"):
            continue

        rows = get_table_rows(table)
        if not rows:
            continue

        if len(headers) == 1:
            label = headers[0]
            values = dedupe_strings(
                [
                    clean_text((row.select("td") or [row])[0])
                    for row in rows
                    if clean_text((row.select("td") or [row])[0]) and not is_noise_value(clean_text((row.select("td") or [row])[0]))
                ]
            )
            values = [value for value in values if value != label]
            if label and values and label not in fields:
                fields[label] = ", ".join(values)
            continue

        if len(rows) != 1:
            continue

        cells = rows[0].select("td")
        for index, label in enumerate(headers[: len(cells)]):
            value = clean_text(cells[index])
            if not label or not value or value == label or is_noise_value(value) or label in fields:
                continue
            fields[label] = value

    return [{"label": label, "value": value} for label, value in fields.items()]


def read_addenda(soup: BeautifulSoup, base_url: str) -> List[Dict[str, Optional[str]]]:
    addenda: List[Dict[str, Optional[str]]] = []
    seen = set()

    for table in soup.select("table"):
        headers = get_table_headers(table)
        if not is_addenda_table(headers) and not is_amendment_history_table(headers):
            continue

        for row in get_table_rows(table):
            cells = row.find_all("td")
            if not cells:
                continue

            title = ""
            date = None
            link_url = None

            if is_amendment_history_table(headers):
                amendment_number = normalize_whitespace(cells[0].get_text(" ", strip=True) if len(cells) > 0 else "")
                reason = normalize_whitespace(cells[1].get_text(" ", strip=True) if len(cells) > 1 else "")
                if amendment_number and reason:
                    title = f"Amendment {amendment_number}: {reason}"
                else:
                    title = reason or (f"Amendment {amendment_number}" if amendment_number else "")
                date = parse_date_to_iso(cells[2].get_text(" ", strip=True) if len(cells) > 2 else None)
                link = row.select_one("a[href*='download_public']")
                link_url = to_absolute_url(base_url, link.get("href") if link else None)
            else:
                title = normalize_whitespace(cells[0].get_text(" ", strip=True))
                date = parse_date_to_iso(cells[1].get_text(" ", strip=True) if len(cells) > 1 else None)
                link = cells[0].select_one("a[href]")
                link_url = to_absolute_url(base_url, link.get("href") if link else None)

            if not title or re.search(r"title", title, re.IGNORECASE):
                continue

            key = f"{title}::{date or ''}::{link_url or ''}"
            if key in seen:
                continue
            seen.add(key)
            addenda.append(
                {
                    "title": title,
                    "date": date,
                    "link": link_url,
                }
            )

    return addenda


def derive_attachment_name(anchor: Any, url: str) -> str:
    anchor_text = normalize_whitespace(anchor.get_text(" ", strip=True))
    row = anchor.find_parent("tr")

    if row is not None:
        row_candidates: List[str] = []
        for cell in row.select("td"):
            clone = BeautifulSoup(str(cell), "html.parser")
            for removable in clone.select("a[href], .default"):
                removable.decompose()
            value = clean_text(clone)
            if value and not is_attachment_metadata(value):
                row_candidates.append(value)

        row_candidates = dedupe_strings(row_candidates)
        row_title = next((value for value in row_candidates if value != anchor_text), row_candidates[0] if row_candidates else "")
        if row_title and anchor_text and row_title != anchor_text and anchor_text not in row_title and row_title not in anchor_text:
            return f"{row_title} - {anchor_text}"
        if row_title:
            return row_title

    return anchor_text or file_name_from_url(url) or "Attachment"


def read_attachments(soup: BeautifulSoup, base_url: str, excluded_urls: set[str]) -> List[Dict[str, str]]:
    attachments: List[Dict[str, str]] = []
    seen = set()

    for element in soup.select("a[href*='download_public']"):
        if is_hidden_context(element):
            continue

        url = to_absolute_url(base_url, element.get("href"))
        if not url or url in excluded_urls or url in seen:
            continue

        seen.add(url)
        attachments.append(
            {
                "url": url,
                "name": derive_attachment_name(element, url),
            }
        )

    return attachments


def merge_fields(*collections: List[Dict[str, str]]) -> List[Dict[str, str]]:
    fields: Dict[str, str] = {}
    for collection in collections:
        for field in collection:
            if field["label"] not in fields:
                fields[field["label"]] = field["value"]
    return [{"label": label, "value": value} for label, value in fields.items()]


def parse_detail_page(html: str, base_url: str, page_url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    detail_fields = merge_fields(read_field_rows(soup), read_grid_fields(soup))
    addenda = read_addenda(soup, base_url)
    attachments = read_attachments(
        soup,
        base_url,
        {addendum["link"] for addendum in addenda if addendum.get("link")},
    )

    description_element = soup.select_one("[data-testid='description'], [class*='description'], [id*='description']")
    description_text = clean_text(description_element)
    if not description_text or is_noise_value(description_text) or is_boilerplate_description(description_text):
        description_text = next(
            (field["value"] for field in detail_fields if re.search(r"summary details", field["label"], re.IGNORECASE)),
            "",
        )
    if not description_text or is_noise_value(description_text) or is_boilerplate_description(description_text):
        description_text = next(
            (
                field["value"]
                for field in detail_fields
                if re.fullmatch(r"(opportunity )?description", field["label"], re.IGNORECASE)
            ),
            "",
        )
    if not description_text or is_noise_value(description_text) or is_boilerplate_description(description_text):
        description_text = clean_text(soup.select_one(".iv-rich-text, .iv-html"))

    process_id = extract_process_id(page_url)
    if not process_id:
        joined_links = " ".join(
            [
                element.get("href", "")
                for element in soup.select("a[href*='process_manage_extranet']")
            ]
        )
        process_id = extract_process_id(joined_links)

    return {
        "processId": process_id,
        "detailUrl": page_url,
        "descriptionText": description_text,
        "detailFields": detail_fields,
        "addenda": addenda,
        "attachments": attachments,
        "sourceCapturedAt": utc_now_iso(),
    }


def ensure_dir(path_value: Path) -> None:
    path_value.mkdir(parents=True, exist_ok=True)


def create_run_artifact_dir(base_dir: Path, run_id: str) -> Path:
    run_dir = base_dir / run_id
    ensure_dir(run_dir)
    return run_dir


def write_artifact(run_dir: Path, filename: str, contents: str) -> Path:
    target = run_dir / filename
    target.write_text(contents, encoding="utf-8")
    return target


async def capture_page_artifacts(page: Any, run_dir: Path, name: str) -> None:
    safe_name = re.sub(r"[^a-z0-9-_]+", "-", name, flags=re.IGNORECASE).lower()
    write_artifact(run_dir, f"{safe_name}.html", await page.content())
    await page.screenshot(path=str(run_dir / f"{safe_name}.png"), full_page=True)


class IngestClient:
    def __init__(self, site_url: str, shared_secret: str):
        self.site_url = site_url.rstrip("/")
        self.shared_secret = shared_secret
        self.client = httpx.AsyncClient(timeout=120.0)

    async def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = await self.client.post(
            f"{self.site_url}{path}",
            headers={
                "Authorization": f"Bearer {self.shared_secret}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        body = None
        try:
            body = response.json()
        except Exception:
            body = None

        if response.status_code >= 400:
            error_message = body.get("error") if isinstance(body, dict) else None
            raise RuntimeError(error_message or f"Convex ingest request failed with status {response.status_code}.")

        return body if isinstance(body, dict) else {}

    async def update_progress(self, run_id: str, progress: Dict[str, Any], counts: Dict[str, int]) -> None:
        await self.post("/ingest/runs/progress", {"runId": run_id, "progress": progress, "counts": counts})

    async def upsert_batch(self, run_id: str, batch: List[Dict[str, Any]]) -> None:
        await self.post("/ingest/opportunities/batch", {"runId": run_id, "batch": batch})

    async def finish_run(
        self,
        run_id: str,
        status: str,
        counts: Dict[str, int],
        *,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
        artifact_path: Optional[str] = None,
    ) -> None:
        await self.post(
            "/ingest/runs/finish",
            {
                "runId": run_id,
                "status": status,
                "completedAt": now_ms(),
                "counts": counts,
                "errorCode": error_code,
                "errorMessage": error_message,
                "artifactPath": artifact_path,
            },
        )

    async def close(self) -> None:
        await self.client.aclose()


class ProgressReporter:
    def __init__(self, run_id: str, ingest_client: IngestClient, counts: Dict[str, int]):
        self.run_id = run_id
        self.ingest_client = ingest_client
        self.counts = counts
        self.progress: Dict[str, Any] = {
            "phase": "queued",
            "message": "Run accepted. Waiting for scraper worker.",
            "percent": 0,
            "current": 0,
            "total": None,
            "pagesCompleted": 0,
            "totalPages": None,
            "listingsDiscovered": 0,
            "detailsCompleted": 0,
            "detailsTotal": None,
            "batchesCompleted": 0,
            "batchesTotal": None,
            "heartbeatAt": now_ms(),
        }

    async def update(self, patch: Dict[str, Any]) -> None:
        self.progress = {
            **self.progress,
            **patch,
            "percent": max(0, min(100, round(patch.get("percent", self.progress["percent"])))),
            "heartbeatAt": now_ms(),
        }
        await self.ingest_client.update_progress(self.run_id, dict(self.progress), dict(self.counts))

    def snapshot(self) -> Dict[str, Any]:
        return dict(self.progress)


def throw_if_stopped() -> None:
    if STOP_REQUESTED:
        raise ScrapeCancelledError("Scrape cancelled by operator.")


async def wait_for_results_grid(page: Any) -> None:
    await page.wait_for_function(
        "() => Boolean(document.querySelector('#body_x_grid_grd')) || /no record/i.test(document.body?.textContent ?? '')",
        timeout=30000,
    )


async def try_return_to_opportunities(page: Any) -> bool:
    locator = page.locator(
        "a[href*='/page.aspx/en/rfp/request_browse_public'], "
        "a:has-text('Opportunities'), "
        "button:has-text('Opportunities')"
    )

    if await locator.count() == 0:
        return False

    try:
        await asyncio.gather(
            page.wait_for_load_state("domcontentloaded", timeout=10000),
            locator.first.click(),
        )
    except Exception:
        pass

    return True


async def wait_for_browser_check(page: Any, run_dir: Path, timeout_ms: int = 30000) -> None:
    deadline = time.monotonic() + (timeout_ms / 1000)
    attempted_solver = False
    opportunities_return_attempts = 0
    max_opportunities_return_attempts = 5

    while "/page.aspx/en/bas/browser_check" in page.url:
        throw_if_stopped()
        try:
            html = await page.content()
        except Exception as error:
            if re.search(r"page is navigating|changing the content", str(error), re.IGNORECASE):
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5000)
                except Exception:
                    pass
                await page.wait_for_timeout(250)
                continue
            raise
        state = parse_browser_check_page(html)

        if (
            opportunities_return_attempts < max_opportunities_return_attempts
            and state["message"]
            and re.search(r"wrong captcha answer", state["message"], re.IGNORECASE)
        ):
            opportunities_return_attempts += 1
            returned_to_opportunities = await try_return_to_opportunities(page)
            if returned_to_opportunities:
                print(
                    f"[botright] Browser check returned 'Wrong captcha answer'. Retrying via Opportunities "
                    f"({opportunities_return_attempts}/{max_opportunities_return_attempts}).",
                    file=sys.stderr,
                )
                await page.wait_for_timeout(1000)
                continue

        if state["hasCaptcha"] and not attempted_solver and hasattr(page, "solve_recaptcha"):
            attempted_solver = True
            try:
                await page.solve_recaptcha()
            except Exception as error:
                print(f"[botright] solve_recaptcha failed: {error}", file=sys.stderr)
            deadline = max(deadline, time.monotonic() + (timeout_ms / 1000))

        if time.monotonic() > deadline:
            await capture_page_artifacts(page, run_dir, "browser-check")
            raise RuntimeError(
                f"BC Bid browser check did not complete after {timeout_ms // 1000}s. "
                f"hasCaptcha={str(state['hasCaptcha']).lower()} message={state['message'] or 'n/a'}"
            )

        await page.wait_for_timeout(2000)


async def wait_for_search_page(page: Any, config: Dict[str, Any], run_dir: Path) -> None:
    throw_if_stopped()
    await page.goto(
        f"{config['baseUrl']}{SEARCH_PATH}",
        wait_until="domcontentloaded",
        timeout=config["browser"]["browserCheckTimeoutMs"],
    )
    await wait_for_browser_check(page, run_dir, config["browser"]["browserCheckTimeoutMs"])
    await page.wait_for_selector("#mainForm", timeout=30000)


async def apply_filters(page: Any, config: Dict[str, Any]) -> None:
    filters = [
        {"kind": "select", "name": "body:x:selSrfxCode", "value": config["filters"].get("status")},
        {"kind": "fill", "name": "body:x:txtQuery", "value": config["filters"].get("keyword")},
        {"kind": "fill", "name": "body:x:txtRfpRfxId_1", "value": config["filters"].get("opportunityId")},
        {"kind": "select", "name": "body:x:selRtgrouCode", "value": config["filters"].get("opportunityType")},
        {"kind": "select", "name": "body:x:selRfpIdAreaLevelAreaNode", "value": config["filters"].get("region")},
        {"kind": "select", "name": "body:x:selBpmIdOrgaLevelOrgaNode", "value": config["filters"].get("organization")},
        {"kind": "select", "name": "body:x:selPtypeCode", "value": config["filters"].get("industryCategory")},
        {"kind": "fill", "name": "body:x:txtRfpBeginDate", "value": config["filters"].get("issueDateMin")},
        {"kind": "fill", "name": "body:x:txtRfpBeginDatemax", "value": config["filters"].get("issueDateMax")},
        {"kind": "fill", "name": "body:x:txtRfpEndDate", "value": config["filters"].get("closingDateMin")},
        {"kind": "fill", "name": "body:x:txtRfpEndDatemax", "value": config["filters"].get("closingDateMax")},
    ]

    for item in filters:
        throw_if_stopped()
        value = item["value"]
        if not value:
            continue

        selector = f'[name="{item["name"]}"]'
        locator = page.locator(selector)
        if await locator.count() == 0:
            continue

        element_info = await page.eval_on_selector(
            selector,
            """node => ({
                tagName: node.tagName.toLowerCase(),
                type: node instanceof HTMLInputElement ? node.type.toLowerCase() : null,
                value: (
                    node instanceof HTMLInputElement ||
                    node instanceof HTMLSelectElement ||
                    node instanceof HTMLTextAreaElement
                ) ? node.value : null
            })""",
        )

        if item["kind"] == "select" and element_info["tagName"] == "select":
            await locator.first.select_option(value)
            continue

        if element_info["tagName"] == "input" and element_info["type"] == "hidden" and element_info["value"] == value:
            continue

        await page.eval_on_selector(
            selector,
            """(node, value) => {
                if (
                    node instanceof HTMLInputElement ||
                    node instanceof HTMLSelectElement ||
                    node instanceof HTMLTextAreaElement
                ) {
                    node.value = value;
                    node.dispatchEvent(new Event("input", { bubbles: true }));
                    node.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }""",
            value,
        )

    search_button = page.locator('button:has-text("Search"), input[type="submit"][value="Search"], .ui.button:has-text("Search")')
    if await search_button.count() > 0:
        try:
            await asyncio.gather(
                page.wait_for_load_state("networkidle", timeout=15000),
                search_button.first.click(),
            )
        except Exception:
            pass

    throw_if_stopped()
    await wait_for_results_grid(page)


async def go_to_page(page: Any, page_index: int) -> None:
    throw_if_stopped()
    expected = str(page_index)

    try:
        await asyncio.gather(
            page.wait_for_load_state("networkidle", timeout=15000),
            page.evaluate(
                """(index) => {
                    const controls = window.__ivCtrl;
                    const control = controls?.["body_x_grid_grd"];
                    if (!control?.GoToPageOfGrid) {
                        throw new Error("BC Bid grid control was not found.");
                    }
                    control.GoToPageOfGrid(0, index);
                }""",
                page_index,
            ),
        )
    except Exception:
        pass

    await page.wait_for_function(
        """(value) => {
            const input = document.querySelector("input[name='hdnCurrentPageIndexbody_x_grid_grd'], #hdnCurrentPageIndexbody_x_grid_grd");
            return !input || input.value === value;
        }""",
        expected,
        timeout=15000,
    )

    throw_if_stopped()
    await wait_for_results_grid(page)


async def collect_listings(
    page: Any,
    config: Dict[str, Any],
    run_dir: Path,
    counts: Dict[str, int],
    progress_reporter: ProgressReporter,
) -> Dict[str, Any]:
    listings: Dict[str, Dict[str, Any]] = {}

    first_page = parse_listing_page(await page.content(), config["baseUrl"])
    body_text = await page.text_content("body") or ""

    if not first_page["opportunities"] and not re.search(r"no record", body_text, re.IGNORECASE):
        await capture_page_artifacts(page, run_dir, "empty-listing-page")
        raise RuntimeError("Listing page loaded without a results grid or recognizable empty-state message.")

    for item in first_page["opportunities"]:
        listings[item["sourceKey"]] = item

    total_pages = first_page["totalPages"]
    counts["pageCount"] = 1 if total_pages > 0 else 0
    counts["listingCount"] = len(listings)

    await progress_reporter.update(
        {
            "phase": "listing",
            "message": f"Parsed listing page 1 of {total_pages}.",
            "percent": 22,
            "current": 1,
            "total": total_pages,
            "pagesCompleted": counts["pageCount"],
            "totalPages": total_pages,
            "listingsDiscovered": len(listings),
        }
    )

    for zero_based_index in range(1, total_pages):
        throw_if_stopped()
        await go_to_page(page, zero_based_index)
        parsed = parse_listing_page(await page.content(), config["baseUrl"])
        total_pages = max(total_pages, parsed["totalPages"])

        for item in parsed["opportunities"]:
            listings[item["sourceKey"]] = item

        counts["pageCount"] = zero_based_index + 1
        counts["listingCount"] = len(listings)

        await progress_reporter.update(
            {
                "phase": "listing",
                "message": f"Parsed listing page {zero_based_index + 1} of {total_pages}.",
                "percent": 22 + ((zero_based_index + 1) / max(total_pages, 1)) * 16,
                "current": zero_based_index + 1,
                "total": total_pages,
                "pagesCompleted": counts["pageCount"],
                "totalPages": total_pages,
                "listingsDiscovered": len(listings),
            }
        )

    return {"listings": list(listings.values()), "pageCount": total_pages}


async def open_detail_tabs(page: Any) -> None:
    for tab_name in ["Overview", "Opportunity Details", "Addenda", "Interested Supplier List"]:
        throw_if_stopped()
        selector = f'a:has-text("{tab_name}"), button:has-text("{tab_name}"), [role="tab"]:has-text("{tab_name}")'
        tab_locator = page.locator(selector)
        if await tab_locator.count() == 0:
            continue

        try:
            await asyncio.gather(page.wait_for_load_state("networkidle", timeout=5000), tab_locator.first.click())
            await page.wait_for_timeout(200)
        except Exception:
            pass


async def scrape_detail(browser_context: Any, config: Dict[str, Any], run_dir: Path, listing: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    throw_if_stopped()
    if not listing["detailUrl"]:
        return None

    page = await browser_context.new_page()
    try:
        await page.goto(listing["detailUrl"], wait_until="domcontentloaded")
        await page.wait_for_selector("body", timeout=20000)
        await open_detail_tabs(page)
        throw_if_stopped()
        return parse_detail_page(await page.content(), config["baseUrl"], page.url)
    except Exception:
        if STOP_REQUESTED:
            raise ScrapeCancelledError("Scrape cancelled by operator.")
        await capture_page_artifacts(page, run_dir, f"detail-{listing['sourceKey']}")
        raise
    finally:
        try:
            await page.close()
        except Exception:
            pass


async def scrape_details(
    browser_context: Any,
    listings: List[Dict[str, Any]],
    config: Dict[str, Any],
    run_dir: Path,
    counts: Dict[str, int],
    progress_reporter: ProgressReporter,
) -> Dict[str, Any]:
    detail_map: Dict[str, Optional[Dict[str, Any]]] = {}

    await progress_reporter.update(
        {
            "phase": "detail",
            "message": f"Preparing {len(listings)} detail pages." if listings else "No detail pages were discovered.",
            "percent": 40 if listings else 78,
            "current": 0,
            "total": len(listings),
            "detailsCompleted": 0,
            "detailsTotal": len(listings),
        }
    )

    completed = 0
    for listing in listings:
        throw_if_stopped()

        try:
            detail = await scrape_detail(browser_context, config, run_dir, listing)
            detail_map[listing["sourceKey"]] = detail
            if detail:
                counts["detailCount"] += 1
        except ScrapeCancelledError:
            raise
        except Exception:
            counts["failedDetails"] += 1
            detail_map[listing["sourceKey"]] = None

        completed += 1
        await progress_reporter.update(
            {
                "phase": "detail",
                "message": f"Scraped detail {completed} of {len(listings)}.",
                "percent": 40 + (completed / max(len(listings), 1)) * 36,
                "current": completed,
                "total": len(listings),
                "detailsCompleted": completed,
                "detailsTotal": len(listings),
            }
        )

    return {"detailMap": detail_map}


def emit_terminal_message(run_id: str, status: str, counts: Dict[str, int], artifact_path: Optional[str], error_message: Optional[str] = None) -> None:
    print(
        "BOTRIGHT_RESULT "
        + json.dumps(
            {
                "runId": run_id,
                "status": status,
                "counts": counts,
                "artifactPath": artifact_path,
                "errorMessage": error_message,
            }
        ),
        flush=True,
    )


def limit_listings(listings: List[Dict[str, Any]], max_listings: Optional[int]) -> List[Dict[str, Any]]:
    if not max_listings or len(listings) <= max_listings:
        return listings
    return listings[:max_listings]


async def run_scrape() -> None:
    global ACTIVE_BROWSER

    run_id = os.environ["BOTRIGHT_RUN_ID"]
    trigger = os.environ["BOTRIGHT_TRIGGER"]
    config = json.loads(os.environ["BOTRIGHT_CONFIG_JSON"])

    counts = empty_counts()
    artifact_dir = Path(config["artifactDir"])
    ensure_dir(Path(config["userDataDir"]))
    ensure_dir(artifact_dir)
    run_dir = create_run_artifact_dir(artifact_dir, run_id)

    ingest_client = IngestClient(config["convexSiteUrl"], config["ingestSharedSecret"])
    progress_reporter = ProgressReporter(run_id, ingest_client, counts)

    browser_client = None
    browser_context = None

    try:
        await progress_reporter.update({"phase": "booting", "message": "Launching Botright worker.", "percent": 3})

        browser_client = await botright.Botright(headless=config["browser"]["headless"])
        browser_context = await browser_client.new_browser()
        ACTIVE_BROWSER = browser_context

        page = await browser_context.new_page()

        await progress_reporter.update({"phase": "booting", "message": "Opening BC Bid public opportunities search.", "percent": 8})
        await wait_for_search_page(page, config, run_dir)

        await progress_reporter.update({"phase": "listing", "message": "Applying search filters.", "percent": 14})
        await apply_filters(page, config)

        await progress_reporter.update({"phase": "listing", "message": "Collecting listing pages.", "percent": 18})
        listing_result = await collect_listings(page, config, run_dir, counts, progress_reporter)
        discovered_listings = listing_result["listings"]
        listings = limit_listings(discovered_listings, config.get("maxListings"))
        counts["pageCount"] = listing_result["pageCount"]
        counts["listingCount"] = len(listings)

        if len(discovered_listings) != len(listings):
            await progress_reporter.update(
                {
                    "phase": "listing",
                    "message": f"Collected {len(discovered_listings)} listings. Limiting detail scrape to first {len(listings)}.",
                    "percent": 38,
                    "current": len(listings),
                    "total": len(discovered_listings),
                    "listingsDiscovered": len(discovered_listings),
                }
            )

        detail_result = await scrape_details(browser_context, listings, config, run_dir, counts, progress_reporter)
        records = [merge_opportunity_record(listing, detail_result["detailMap"].get(listing["sourceKey"])) for listing in listings]

        counts["opportunityCount"] = len(records)
        counts["addendaCount"] = sum(len(item["addenda"]) for item in records)
        counts["attachmentCount"] = sum(len(item["attachments"]) for item in records)

        batches = chunk(records, config["ingestBatchSize"])
        await progress_reporter.update(
            {
                "phase": "ingesting",
                "message": f"Persisting {len(batches)} opportunity batches." if batches else "No records to persist.",
                "percent": 80 if batches else 96,
                "current": 0,
                "total": len(batches),
                "batchesCompleted": 0,
                "batchesTotal": len(batches),
                "detailsCompleted": len(listings),
                "detailsTotal": len(listings),
                "listingsDiscovered": len(listings),
            }
        )

        for index, batch in enumerate(batches, start=1):
            throw_if_stopped()
            await ingest_client.upsert_batch(run_id, batch)
            await progress_reporter.update(
                {
                    "phase": "ingesting",
                    "message": f"Persisted batch {index} of {len(batches)}.",
                    "percent": 80 + (index / max(len(batches), 1)) * 18,
                    "current": index,
                    "total": len(batches),
                    "batchesCompleted": index,
                    "batchesTotal": len(batches),
                    "detailsCompleted": len(listings),
                    "detailsTotal": len(listings),
                    "listingsDiscovered": len(listings),
                }
            )

        await progress_reporter.update(
            {
                "phase": "ingesting",
                "message": "Writing scrape summary.",
                "percent": 98,
                "current": len(batches),
                "total": len(batches),
            }
        )

        write_artifact(
            run_dir,
            "summary.json",
            json.dumps(
                {
                    "trigger": trigger,
                    "runId": run_id,
                    "counts": counts,
                    "completedAt": utc_now_iso(),
                },
                indent=2,
            ),
        )

        artifact_path = os.path.relpath(run_dir, os.getcwd())
        await ingest_client.finish_run(run_id, "succeeded", counts, artifact_path=artifact_path)
        emit_terminal_message(run_id, "succeeded", counts, str(run_dir))
    except Exception as error:
        cancelled = isinstance(error, ScrapeCancelledError) or STOP_REQUESTED
        terminal_status = "cancelled" if cancelled else "failed"
        error_code = "SCRAPE_CANCELLED" if cancelled else "SCRAPE_FAILED"
        error_message = "Scrape cancelled by operator." if cancelled else str(error)

        write_artifact(
            run_dir,
            "cancelled.json" if cancelled else "error.json",
            json.dumps(
                {
                    "runId": run_id,
                    "trigger": trigger,
                    "error": error_message,
                    "finishedAt": utc_now_iso(),
                    "counts": counts,
                },
                indent=2,
            ),
        )

        try:
            await progress_reporter.update(
                {
                    "phase": "stopping" if cancelled else "failed",
                    "message": error_message,
                    "percent": progress_reporter.snapshot()["percent"] if cancelled else min(progress_reporter.snapshot()["percent"], 99),
                }
            )
        except Exception:
            pass

        artifact_path = os.path.relpath(run_dir, os.getcwd())
        await ingest_client.finish_run(
            run_id,
            terminal_status,
            counts,
            error_code=error_code,
            error_message=error_message,
            artifact_path=artifact_path,
        )
        emit_terminal_message(run_id, terminal_status, counts, str(run_dir), error_message)

        if not cancelled:
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            raise
    finally:
        ACTIVE_BROWSER = None
        if browser_context is not None:
            try:
                await browser_context.close()
            except Exception:
                pass
        if browser_client is not None:
            try:
                close_client = getattr(browser_client, "close", None)
                if close_client is not None:
                    await close_client()
            except Exception:
                pass
        await ingest_client.close()


def install_signal_handlers() -> None:
    loop = asyncio.get_running_loop()

    def request_stop() -> None:
        global STOP_REQUESTED
        STOP_REQUESTED = True
        if ACTIVE_BROWSER is not None:
            loop.create_task(ACTIVE_BROWSER.close())

    for signame in ("SIGINT", "SIGTERM"):
        if hasattr(signal, signame):
            signal.signal(getattr(signal, signame), lambda _sig, _frame: request_stop())


async def main() -> None:
    install_signal_handlers()
    await run_scrape()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        sys.exit(1)
