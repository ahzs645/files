import { buildContractAwardEntityKey, isPlaceholderContractAwardSupplier, normalizeContractAwardEntityLabel, } from "@bcbid/shared";
const TOP_LIST_LIMIT = 10;
const ORGANIZATION_TYPE_MIX_LIMIT = 6;
const ENTITY_OPTION_LIMIT = 8;
const PROFILE_AWARDS_LIMIT = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function roundRate(numerator, denominator) {
    if (denominator <= 0) {
        return 0;
    }
    return numerator / denominator;
}
function median(values) {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
}
function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}
function toDateString(date) {
    return date.toISOString().slice(0, 10);
}
function shiftYears(dateString, years) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCFullYear(date.getUTCFullYear() + years);
    return toDateString(date);
}
function normalizeAwardLabel(value, fallback) {
    return normalizeContractAwardEntityLabel(value) ?? fallback;
}
function groupBy(items, getKey) {
    const groups = new Map();
    for (const item of items) {
        const key = getKey(item);
        const existing = groups.get(key);
        if (existing) {
            existing.push(item);
        }
        else {
            groups.set(key, [item]);
        }
    }
    return groups;
}
function getFieldForKind(item, kind) {
    return kind === "supplier"
        ? normalizeAwardLabel(item.successfulSupplier, "Unknown supplier")
        : normalizeAwardLabel(item.issuingOrganization, "Unknown organization");
}
function getCounterpartyLabel(item, kind) {
    return kind === "supplier"
        ? normalizeAwardLabel(item.issuingOrganization, "Unknown organization")
        : normalizeAwardLabel(item.successfulSupplier, "Unknown supplier");
}
function createSummaryMetrics(items) {
    const values = items
        .map((item) => item.contractValue)
        .filter((value) => value !== null);
    const totalAwardValue = values.reduce((total, value) => total + value, 0);
    const totalAwards = items.length;
    return {
        totalAwards,
        totalAwardValue,
        uniqueSuppliers: new Set(items.map((item) => normalizeAwardLabel(item.successfulSupplier, "Unknown supplier"))).size,
        uniqueIssuingOrganizations: new Set(items.map((item) => normalizeAwardLabel(item.issuingOrganization, "Unknown organization"))).size,
        averageAwardValue: totalAwards > 0 ? totalAwardValue / totalAwards : null,
        medianAwardValue: median(values),
        contractNumberCoverage: roundRate(items.filter((item) => Boolean(item.contractNumber)).length, totalAwards),
        justificationCoverage: roundRate(items.filter((item) => Boolean(item.justification)).length, totalAwards),
        placeholderSupplierShare: roundRate(items.filter((item) => isPlaceholderContractAwardSupplier(item.successfulSupplier)).length, totalAwards),
    };
}
function createDataQualitySummary(items) {
    const today = getTodayDateString();
    const totalRows = items.length;
    const placeholderSupplierCount = items.filter((item) => isPlaceholderContractAwardSupplier(item.successfulSupplier)).length;
    const missingContractNumberCount = items.filter((item) => !item.contractNumber).length;
    const missingSupplierAddressCount = items.filter((item) => !item.supplierAddress).length;
    const missingContactEmailCount = items.filter((item) => !item.contactEmail).length;
    const missingJustificationCount = items.filter((item) => !item.justification).length;
    const futureDatedAwardCount = items.filter((item) => item.awardDate && item.awardDate > today).length;
    return {
        totalRows,
        placeholderSupplierCount,
        placeholderSupplierRate: roundRate(placeholderSupplierCount, totalRows),
        missingContractNumberCount,
        missingContractNumberRate: roundRate(missingContractNumberCount, totalRows),
        missingSupplierAddressCount,
        missingSupplierAddressRate: roundRate(missingSupplierAddressCount, totalRows),
        missingContactEmailCount,
        missingContactEmailRate: roundRate(missingContactEmailCount, totalRows),
        missingJustificationCount,
        missingJustificationRate: roundRate(missingJustificationCount, totalRows),
        futureDatedAwardCount,
        futureDatedAwardRate: roundRate(futureDatedAwardCount, totalRows),
    };
}
function createBreakdownRow(key, label, items, totalAwards, totalValue) {
    const awardCount = items.length;
    const rowValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    return {
        key,
        label,
        awardCount,
        totalValue: rowValue,
        shareOfAwards: roundRate(awardCount, totalAwards),
        shareOfValue: roundRate(rowValue, totalValue),
    };
}
function createRankingRow(key, label, items, totalAwards, totalValue, secondaryLabel, placeholder) {
    const breakdown = createBreakdownRow(key, label, items, totalAwards, totalValue);
    return {
        ...breakdown,
        averageValue: breakdown.awardCount > 0 ? breakdown.totalValue / breakdown.awardCount : null,
        secondaryLabel,
        placeholder,
    };
}
function sortRankingRows(rows, sortBy) {
    return [...rows].sort((left, right) => {
        if (sortBy === "count" && left.awardCount !== right.awardCount) {
            return right.awardCount - left.awardCount;
        }
        if (left.totalValue !== right.totalValue) {
            return right.totalValue - left.totalValue;
        }
        return left.label.localeCompare(right.label);
    });
}
function getDateRangeForPreset(filters) {
    const preset = filters.datePreset ?? "all";
    const today = getTodayDateString();
    let fromDate = filters.fromDate ?? null;
    let toDate = filters.toDate ?? null;
    if (preset === "1y") {
        fromDate = shiftYears(today, -1);
        toDate = today;
    }
    else if (preset === "3y") {
        fromDate = shiftYears(today, -3);
        toDate = today;
    }
    if (fromDate && toDate && fromDate > toDate) {
        [fromDate, toDate] = [toDate, fromDate];
    }
    return {
        datePreset: preset,
        fromDate,
        toDate,
        opportunityType: filters.opportunityType ?? null,
        includePlaceholderSuppliers: filters.includePlaceholderSuppliers ?? false,
        minimumAwardValue: filters.minimumAwardValue ?? null,
    };
}
function getTrendBucket(filters) {
    if (filters.datePreset === "1y") {
        return "month";
    }
    if (filters.datePreset === "3y") {
        return "quarter";
    }
    if (filters.datePreset === "custom" && filters.fromDate && filters.toDate) {
        const diffDays = Math.max(0, Math.round((new Date(`${filters.toDate}T00:00:00.000Z`).getTime() -
            new Date(`${filters.fromDate}T00:00:00.000Z`).getTime()) /
            MS_PER_DAY));
        if (diffDays <= 548) {
            return "month";
        }
        if (diffDays <= 1825) {
            return "quarter";
        }
    }
    return "year";
}
export function applyContractAwardAnalysisFilters(docs, filters) {
    const appliedFilters = getDateRangeForPreset(filters);
    const trendBucket = getTrendBucket(appliedFilters);
    const items = docs.filter((item) => {
        if (!appliedFilters.includePlaceholderSuppliers &&
            isPlaceholderContractAwardSupplier(item.successfulSupplier)) {
            return false;
        }
        if (appliedFilters.opportunityType &&
            item.opportunityType !== appliedFilters.opportunityType) {
            return false;
        }
        if (appliedFilters.minimumAwardValue !== null &&
            (item.contractValue ?? 0) < appliedFilters.minimumAwardValue) {
            return false;
        }
        if (appliedFilters.fromDate && (!item.awardDate || item.awardDate < appliedFilters.fromDate)) {
            return false;
        }
        if (appliedFilters.toDate && (!item.awardDate || item.awardDate > appliedFilters.toDate)) {
            return false;
        }
        return true;
    });
    return {
        appliedFilters,
        trendBucket,
        items,
    };
}
function getPeriodStart(value, bucket) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (bucket === "month") {
        date.setUTCDate(1);
        return toDateString(date);
    }
    if (bucket === "quarter") {
        const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
        date.setUTCMonth(quarterMonth, 1);
        return toDateString(date);
    }
    date.setUTCMonth(0, 1);
    return toDateString(date);
}
function getPeriodEnd(start, bucket) {
    const date = new Date(`${start}T00:00:00.000Z`);
    if (bucket === "month") {
        date.setUTCMonth(date.getUTCMonth() + 1, 0);
        return toDateString(date);
    }
    if (bucket === "quarter") {
        date.setUTCMonth(date.getUTCMonth() + 3, 0);
        return toDateString(date);
    }
    date.setUTCMonth(12, 0);
    return toDateString(date);
}
function getPeriodLabel(start, bucket) {
    const date = new Date(`${start}T00:00:00.000Z`);
    if (bucket === "month") {
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            year: "numeric",
        }).format(date);
    }
    if (bucket === "quarter") {
        return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
    }
    return String(date.getUTCFullYear());
}
function createTrendPoints(items, bucket) {
    const grouped = new Map();
    for (const item of items) {
        if (!item.awardDate) {
            continue;
        }
        const periodStart = getPeriodStart(item.awardDate, bucket);
        const existing = grouped.get(periodStart);
        if (existing) {
            existing.push(item);
        }
        else {
            grouped.set(periodStart, [item]);
        }
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([periodStart, periodItems]) => ({
        label: getPeriodLabel(periodStart, bucket),
        periodStart,
        periodEnd: getPeriodEnd(periodStart, bucket),
        awardCount: periodItems.length,
        totalValue: periodItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0),
    }));
}
function createRankingRowsForKind(items, kind, sortBy, limit = TOP_LIST_LIMIT) {
    const totalAwards = items.length;
    const totalValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    const groups = groupBy(items, (item) => getFieldForKind(item, kind));
    const rows = [...groups.entries()].map(([label, groupItems]) => createRankingRow(buildContractAwardEntityKey(label), label, groupItems, totalAwards, totalValue, null, kind === "supplier" && isPlaceholderContractAwardSupplier(label)));
    return sortRankingRows(rows, sortBy).slice(0, limit);
}
function createConcentrationRows(items) {
    const totalValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    const groups = [...groupBy(items, (item) => getFieldForKind(item, "supplier")).values()]
        .map((groupItems) => ({
        value: groupItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0),
        items: groupItems,
    }))
        .sort((left, right) => right.value - left.value);
    const slices = [
        { key: "top1", label: "Top supplier", groupCount: 1 },
        { key: "top5", label: "Top 5 suppliers", groupCount: 5 },
        { key: "top10", label: "Top 10 suppliers", groupCount: 10 },
    ];
    return slices.map((slice) => {
        const selected = groups.slice(0, slice.groupCount).flatMap((group) => group.items);
        return createBreakdownRow(slice.key, slice.label, selected, groups.length, totalValue);
    });
}
function createSupplierDiversityDistribution(items) {
    const supplierGroups = groupBy(items, (item) => getFieldForKind(item, "supplier"));
    const bins = new Map([
        ["single", []],
        ["few", []],
        ["multi", []],
        ["broad", []],
    ]);
    for (const [, groupItems] of supplierGroups) {
        const organizationCount = new Set(groupItems.map((item) => getFieldForKind(item, "organization"))).size;
        const bucketKey = organizationCount <= 1
            ? "single"
            : organizationCount <= 3
                ? "few"
                : organizationCount <= 9
                    ? "multi"
                    : "broad";
        bins.get(bucketKey).push(...groupItems);
    }
    const totalSuppliers = supplierGroups.size;
    const totalValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    const labels = {
        single: "1 issuing organization",
        few: "2-3 issuing organizations",
        multi: "4-9 issuing organizations",
        broad: "10+ issuing organizations",
    };
    return [...bins.entries()].map(([key, bucketItems]) => ({
        key,
        label: labels[key],
        awardCount: bucketItems.length > 0
            ? new Set(bucketItems.map((item) => getFieldForKind(item, "supplier"))).size
            : 0,
        totalValue: bucketItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0),
        shareOfAwards: roundRate(bucketItems.length > 0
            ? new Set(bucketItems.map((item) => getFieldForKind(item, "supplier"))).size
            : 0, totalSuppliers),
        shareOfValue: roundRate(bucketItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0), totalValue),
    }));
}
function createTopSupplierConcentrationRows(items) {
    const organizationGroups = groupBy(items, (item) => getFieldForKind(item, "organization"));
    const rows = [...organizationGroups.entries()].map(([label, groupItems]) => {
        const supplierGroups = groupBy(groupItems, (item) => getFieldForKind(item, "supplier"));
        const totalValue = groupItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
        const totalAwards = groupItems.length;
        const topSupplier = [...supplierGroups.entries()]
            .map(([supplierLabel, supplierItems]) => ({
            supplierLabel,
            supplierItems,
            totalValue: supplierItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0),
        }))
            .sort((left, right) => right.totalValue - left.totalValue)[0];
        return {
            key: buildContractAwardEntityKey(label),
            label,
            awardCount: totalAwards,
            totalValue,
            shareOfAwards: topSupplier
                ? roundRate(topSupplier.supplierItems.length, totalAwards)
                : 0,
            shareOfValue: topSupplier ? roundRate(topSupplier.totalValue, totalValue) : 0,
            averageValue: totalAwards > 0 ? totalValue / totalAwards : null,
            secondaryLabel: topSupplier?.supplierLabel ?? null,
            placeholder: false,
        };
    });
    return rows
        .sort((left, right) => right.shareOfValue - left.shareOfValue)
        .slice(0, TOP_LIST_LIMIT);
}
function createOrganizationTypeMixRows(items) {
    const topOrganizations = createRankingRowsForKind(items, "organization", "value", ORGANIZATION_TYPE_MIX_LIMIT);
    const organizationGroups = groupBy(items, (item) => getFieldForKind(item, "organization"));
    return topOrganizations.map((row) => {
        const groupItems = organizationGroups.get(row.label) ?? [];
        const typeGroups = groupBy(groupItems, (item) => normalizeAwardLabel(item.opportunityType, "Unknown type"));
        const totalAwards = groupItems.length;
        const totalValue = groupItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
        return {
            key: row.key,
            label: row.label,
            breakdown: [...typeGroups.entries()]
                .map(([label, typeItems]) => createBreakdownRow(buildContractAwardEntityKey(label), label, typeItems, totalAwards, totalValue))
                .sort((left, right) => right.totalValue - left.totalValue),
        };
    });
}
function createOverviewFindings(summary, dataQuality, supplierConcentration) {
    const findings = [];
    const top10Share = supplierConcentration.find((row) => row.key === "top10")?.shareOfValue ?? 0;
    if (summary.placeholderSupplierShare >= 0.25) {
        findings.push({
            code: "placeholder-supplier-share",
            title: "Placeholder suppliers materially affect supplier rankings",
            description: "A large share of awards use placeholder supplier names, so supplier league tables should be interpreted with care.",
            severity: "warning",
        });
    }
    if (dataQuality.missingContractNumberRate >= 0.4) {
        findings.push({
            code: "contract-number-coverage",
            title: "Contract number coverage is limited",
            description: "Many awards do not include a contract number, which weakens downstream matching and auditability.",
            severity: "warning",
        });
    }
    if (dataQuality.missingJustificationRate >= 0.8) {
        findings.push({
            code: "justification-sparsity",
            title: "Justification data is sparse",
            description: "Justification is best treated as a descriptive coverage field, not a reliable comparative signal.",
            severity: "info",
        });
    }
    if (dataQuality.futureDatedAwardCount > 0) {
        findings.push({
            code: "future-dated-awards",
            title: "Future-dated awards were detected",
            description: "Some award dates fall after today and should be reviewed as potential source anomalies or pre-award records.",
            severity: "warning",
        });
    }
    if (top10Share >= 0.6) {
        findings.push({
            code: "supplier-concentration",
            title: "Spend is concentrated among the top suppliers",
            description: "A majority of award value is concentrated in the top 10 suppliers after current filters are applied.",
            severity: "info",
        });
    }
    return findings;
}
function sortAwardsForTable(items) {
    return [...items]
        .sort((left, right) => {
        const leftDate = left.awardDate ?? "0000-00-00";
        const rightDate = right.awardDate ?? "0000-00-00";
        if (leftDate !== rightDate) {
            return rightDate.localeCompare(leftDate);
        }
        const leftValue = left.contractValue ?? -1;
        const rightValue = right.contractValue ?? -1;
        if (leftValue !== rightValue) {
            return rightValue - leftValue;
        }
        return left.importKey.localeCompare(right.importKey);
    })
        .slice(0, PROFILE_AWARDS_LIMIT)
        .map((item) => ({
        importKey: item.importKey,
        opportunityId: item.opportunityId,
        opportunityDescription: item.opportunityDescription,
        opportunityType: item.opportunityType,
        issuingOrganization: item.issuingOrganization,
        issuingLocation: item.issuingLocation,
        contractNumber: item.contractNumber,
        contactEmail: item.contactEmail,
        contractValueText: item.contractValueText,
        contractValue: item.contractValue,
        currency: item.currency,
        successfulSupplier: item.successfulSupplier,
        supplierAddress: item.supplierAddress,
        awardDate: item.awardDate,
        justification: item.justification,
        sourceFileName: item.sourceFileName,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    }));
}
function createOpportunityTypeBreakdown(items) {
    const totalAwards = items.length;
    const totalValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    const groups = groupBy(items, (item) => normalizeAwardLabel(item.opportunityType, "Unknown type"));
    return [...groups.entries()]
        .map(([label, groupItems]) => createBreakdownRow(buildContractAwardEntityKey(label), label, groupItems, totalAwards, totalValue))
        .sort((left, right) => right.totalValue - left.totalValue);
}
function createAwardSizeDistribution(items) {
    const bins = [
        { key: "under-50k", label: "Under $50K", min: 0, max: 50_000 },
        { key: "50k-250k", label: "$50K-$250K", min: 50_000, max: 250_000 },
        { key: "250k-1m", label: "$250K-$1M", min: 250_000, max: 1_000_000 },
        { key: "1m-5m", label: "$1M-$5M", min: 1_000_000, max: 5_000_000 },
        { key: "5m-plus", label: "$5M+", min: 5_000_000, max: Number.POSITIVE_INFINITY },
    ];
    const totalAwards = items.length;
    const totalValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    return bins.map((bin) => createBreakdownRow(bin.key, bin.label, items.filter((item) => {
        const value = item.contractValue ?? 0;
        return value >= bin.min && value < bin.max;
    }), totalAwards, totalValue));
}
function calculateConcentrationToTopCounterparty(items, kind) {
    const groups = groupBy(items, (item) => getCounterpartyLabel(item, kind));
    const totalValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    const topGroup = [...groups.entries()]
        .map(([label, groupItems]) => ({
        label,
        totalValue: groupItems.reduce((sum, item) => sum + (item.contractValue ?? 0), 0),
    }))
        .sort((left, right) => right.totalValue - left.totalValue)[0];
    return {
        label: topGroup?.label ?? null,
        share: topGroup ? roundRate(topGroup.totalValue, totalValue) : null,
    };
}
function createCounterpartyRankings(items, kind) {
    const totalAwards = items.length;
    const totalValue = items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0);
    const groups = groupBy(items, (item) => getCounterpartyLabel(item, kind));
    return [...groups.entries()]
        .map(([label, groupItems]) => createRankingRow(buildContractAwardEntityKey(label), label, groupItems, totalAwards, totalValue, null, kind === "organization" && isPlaceholderContractAwardSupplier(label)))
        .sort((left, right) => right.totalValue - left.totalValue)
        .slice(0, TOP_LIST_LIMIT);
}
function createBenchmark(filteredItems, kind, entityKey) {
    const entityGroups = groupBy(filteredItems, (item) => getFieldForKind(item, kind));
    const targetLabel = [...entityGroups.keys()].find((label) => buildContractAwardEntityKey(label) === entityKey);
    const entityItems = targetLabel ? entityGroups.get(targetLabel) ?? [] : [];
    const peers = [...entityGroups.entries()]
        .filter(([label]) => label !== targetLabel)
        .map(([, groupItems]) => groupItems);
    const entitySummary = createSummaryMetrics(entityItems);
    const entityConcentration = calculateConcentrationToTopCounterparty(entityItems, kind).share;
    return {
        entityMedianAwardValue: entitySummary.medianAwardValue,
        peerMedianAwardValue: median(peers
            .map((peerItems) => createSummaryMetrics(peerItems).medianAwardValue)
            .filter((value) => value !== null)),
        entityAverageAwardValue: entitySummary.averageAwardValue,
        peerAverageAwardValue: median(peers
            .map((peerItems) => createSummaryMetrics(peerItems).averageAwardValue)
            .filter((value) => value !== null)),
        entityConcentration,
        peerMedianConcentration: median(peers
            .map((peerItems) => calculateConcentrationToTopCounterparty(peerItems, kind).share)
            .filter((value) => value !== null)),
        entityAwardCount: entityItems.length,
        peerMedianAwardCount: median(peers.map((peerItems) => peerItems.length)),
    };
}
function pushFinding(findings, code, title, description, severity) {
    findings.push({ code, title, description, severity });
}
function createEntityFindings(kind, items, dataQuality, concentration, uniqueCounterparties, benchmark) {
    const findings = [];
    if (kind === "supplier") {
        if ((concentration ?? 0) >= 0.65) {
            pushFinding(findings, "high-issuer-dependence", "High dependence on one issuing organization", "This supplier draws a large share of award value from a single issuing organization under the current filters.", "warning");
        }
        if (dataQuality.missingContractNumberRate >= 0.5) {
            pushFinding(findings, "supplier-contract-number-coverage", "Contract number coverage is weak", "More than half of the supplier's filtered awards are missing a contract number.", "warning");
        }
        if (dataQuality.futureDatedAwardCount > 0) {
            pushFinding(findings, "supplier-future-awards", "Future-dated awards are present", "At least one award tied to this supplier is dated in the future.", "warning");
        }
        if (uniqueCounterparties <= 2 && items.length > 0) {
            pushFinding(findings, "supplier-low-diversity", "Issuer diversity is low", "This supplier appears across very few issuing organizations in the current slice.", "info");
        }
    }
    else {
        if ((concentration ?? 0) >= 0.5) {
            pushFinding(findings, "org-supplier-concentration", "One supplier dominates award value", "A single supplier accounts for a large share of filtered award value for this issuing organization.", "warning");
        }
        if (dataQuality.placeholderSupplierRate >= 0.3) {
            pushFinding(findings, "org-placeholder-suppliers", "Placeholder suppliers materially affect this issuer", "Placeholder supplier names represent a meaningful share of this issuer's filtered awards.", "warning");
        }
        if (dataQuality.missingContractNumberRate >= 0.5) {
            pushFinding(findings, "org-contract-number-coverage", "Contract number coverage is weak", "More than half of the filtered awards for this issuing organization are missing a contract number.", "warning");
        }
        if (dataQuality.futureDatedAwardCount > 0) {
            pushFinding(findings, "org-future-awards", "Future-dated awards are present", "At least one filtered award for this issuing organization is dated in the future.", "warning");
        }
    }
    if (benchmark.peerMedianConcentration !== null &&
        concentration !== null &&
        concentration > benchmark.peerMedianConcentration * 1.35) {
        pushFinding(findings, "peer-concentration-outlier", "Counterparty concentration is above the peer median", "Relative to peers under the same filters, this entity is more concentrated in a single counterparty.", "info");
    }
    return findings;
}
function createEmptyProfile(entityKind, label, entityKey, appliedFilters, typeOptions) {
    return {
        entityKind,
        counterpartyKind: entityKind === "supplier" ? "organization" : "supplier",
        entityKey,
        label,
        appliedFilters,
        typeOptions,
        summary: {
            ...createSummaryMetrics([]),
            uniqueCounterparties: 0,
            uniqueOpportunityTypes: 0,
            firstAwardDate: null,
            latestAwardDate: null,
            concentrationToTopCounterparty: null,
            topCounterpartyLabel: null,
        },
        trends: [],
        counterpartyRankings: [],
        opportunityTypeMix: [],
        awardSizeDistribution: [],
        benchmark: {
            entityMedianAwardValue: null,
            peerMedianAwardValue: null,
            entityAverageAwardValue: null,
            peerAverageAwardValue: null,
            entityConcentration: null,
            peerMedianConcentration: null,
            entityAwardCount: 0,
            peerMedianAwardCount: null,
        },
        findings: [],
        dataQuality: createDataQualitySummary([]),
        awards: [],
    };
}
function getTypeOptions(items) {
    return [
        ...new Set(items
            .map((item) => item.opportunityType)
            .filter((value) => Boolean(value))),
    ].sort();
}
export function buildContractAwardAnalysisOverview(docs, filters) {
    const typeOptions = getTypeOptions(docs);
    const { appliedFilters, trendBucket, items } = applyContractAwardAnalysisFilters(docs, filters);
    const summary = createSummaryMetrics(items);
    const dataQuality = createDataQualitySummary(items);
    const supplierConcentration = createConcentrationRows(items);
    return {
        appliedFilters,
        typeOptions,
        summary,
        trends: createTrendPoints(items, trendBucket),
        supplierRankings: {
            byValue: createRankingRowsForKind(items, "supplier", "value"),
            byAwardCount: createRankingRowsForKind(items, "supplier", "count"),
            concentration: supplierConcentration,
            diversityDistribution: createSupplierDiversityDistribution(items),
        },
        organizationRankings: {
            byValue: createRankingRowsForKind(items, "organization", "value"),
            byAwardCount: createRankingRowsForKind(items, "organization", "count"),
            topSupplierConcentration: createTopSupplierConcentrationRows(items),
            opportunityTypeMix: createOrganizationTypeMixRows(items),
        },
        dataQuality,
        findings: createOverviewFindings(summary, dataQuality, supplierConcentration),
    };
}
export function buildContractAwardEntityProfile(docs, kind, entityKey, filters) {
    const typeOptions = getTypeOptions(docs);
    const { appliedFilters, trendBucket, items } = applyContractAwardAnalysisFilters(docs, filters);
    const targetLabel = docs
        .map((item) => getFieldForKind(item, kind))
        .find((label) => buildContractAwardEntityKey(label) === entityKey);
    if (!targetLabel) {
        return null;
    }
    const entityItems = items.filter((item) => buildContractAwardEntityKey(getFieldForKind(item, kind)) === entityKey);
    if (entityItems.length === 0) {
        return createEmptyProfile(kind, targetLabel, entityKey, appliedFilters, typeOptions);
    }
    const summary = createSummaryMetrics(entityItems);
    const dataQuality = createDataQualitySummary(entityItems);
    const counterpartyRankings = createCounterpartyRankings(entityItems, kind);
    const concentration = calculateConcentrationToTopCounterparty(entityItems, kind);
    const benchmark = createBenchmark(items, kind, entityKey);
    const datedItems = entityItems
        .map((item) => item.awardDate)
        .filter((value) => Boolean(value))
        .sort();
    return {
        entityKind: kind,
        counterpartyKind: kind === "supplier" ? "organization" : "supplier",
        entityKey,
        label: targetLabel,
        appliedFilters,
        typeOptions,
        summary: {
            ...summary,
            uniqueCounterparties: new Set(entityItems.map((item) => getCounterpartyLabel(item, kind))).size,
            uniqueOpportunityTypes: new Set(entityItems.map((item) => normalizeAwardLabel(item.opportunityType, "Unknown type"))).size,
            firstAwardDate: datedItems[0] ?? null,
            latestAwardDate: datedItems[datedItems.length - 1] ?? null,
            concentrationToTopCounterparty: concentration.share,
            topCounterpartyLabel: concentration.label,
        },
        trends: createTrendPoints(entityItems, trendBucket),
        counterpartyRankings,
        opportunityTypeMix: createOpportunityTypeBreakdown(entityItems),
        awardSizeDistribution: createAwardSizeDistribution(entityItems),
        benchmark,
        findings: createEntityFindings(kind, entityItems, dataQuality, concentration.share, new Set(entityItems.map((item) => getCounterpartyLabel(item, kind))).size, benchmark),
        dataQuality,
        awards: sortAwardsForTable(entityItems),
    };
}
export function buildContractAwardEntityOptions(docs, kind, search, includePlaceholderSuppliers) {
    const filtered = docs.filter((item) => {
        if (kind === "supplier" && !includePlaceholderSuppliers) {
            return !isPlaceholderContractAwardSupplier(item.successfulSupplier);
        }
        return true;
    });
    const groups = groupBy(filtered, (item) => getFieldForKind(item, kind));
    const normalizedSearch = search?.trim().toLowerCase();
    return [...groups.entries()]
        .map(([label, items]) => ({
        kind,
        key: buildContractAwardEntityKey(label),
        label,
        awardCount: items.length,
        totalValue: items.reduce((sum, item) => sum + (item.contractValue ?? 0), 0),
        placeholder: kind === "supplier" && isPlaceholderContractAwardSupplier(label),
    }))
        .filter((item) => normalizedSearch ? item.label.toLowerCase().includes(normalizedSearch) : true)
        .sort((left, right) => {
        if (left.totalValue !== right.totalValue) {
            return right.totalValue - left.totalValue;
        }
        return left.label.localeCompare(right.label);
    })
        .slice(0, ENTITY_OPTION_LIMIT);
}
