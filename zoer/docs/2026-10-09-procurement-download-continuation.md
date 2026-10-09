# Procurement download continuation — 2026-10-09

Target: Zoer's OTE deployment, Procurement package `0.34.4-dev.1791414707`.
No package upgrade, backend rollout, source-code change or browser-engine switch was needed.

## Current scope and recovery

- The displayed Open opportunities scope was 2,696 attachment links from 451 of 670 opportunities; 219 had captured details without saved links.
- Initial continuation `workflow_run_60be6b74-d6ba-4eb8-ba32-1c161b1b7ed5` stopped at 112/451 because the meeting-recording MP4 on `opportunity:223286` did not start. That opportunity remains flagged; it was temporarily excluded from the next batch, without deleting or changing its catalog entry.
- Batch `workflow_run_b7380464-f951-421a-b2e3-809ee029f903` reused saved files and saved nine additional originals. It stopped at 139/450 on the RFQ #9941 attachment for `opportunity:226439`.
- The interactive viewer confirmed a real source message: “The captcha verification failed. Please try again later.” Watch browser's screenshot preview was unavailable, while the interactive viewer connected successfully. No CAPTCHA was answered.
- At the user's direction, the operator returned to the existing opportunity tab and pressed **Opportunities**. The normal BC Bid listing page loaded. Control was returned to Procurement, then the existing batch's **History → Retry** was pressed once.
- Retry `workflow_run_f377911b-8992-4364-ae88-2d2bde8615fc` recovered the blocked PDF and completed 13 new attachment transfers, then stopped at 141/450 on another source verification failure (`opportunity:226766`). This recovery restores some transfers but does not prevent future source verification failures. The full batch is not claimed complete.
- The user then requested the same Opportunities recovery before restarting. The new stopped page was inspected in the same saved browser; normal Opportunities navigation loaded again, control was returned, and one History retry started `workflow_run_a4d3505a-1e5d-4583-9db3-a4d46f4baa13`. It was confirmed running with no error when this continuation was recorded.

## Saved-original verification

The recovered `RFQ #9941 [Mar 12 2026] - 2026 RFQ#9941 Fairness Reviewer Advisory Services.pdf` was read back through the existing catalog's original-file endpoint:

- Document ID: `fa6dac55-9e79-487e-a91e-2a2bef8f6109`
- Size: 498,655 bytes
- SHA-256: `f83f4d50d01dbd2356795e3343e3ecb0993fcaa6921b68a3bf383df5cde8ef27`

Original bytes and catalog metadata matched. A working Opportunities page alone would not establish a saved attachment; this read-back does.

## Workflow limits

Use this as one bounded normal-navigation recovery per inspected stopped attachment in the same saved profile. It is not an automatic retry implementation, a CAPTCHA solution, or evidence that every browser-check failure is a glitch. If the same attachment still requires verification after that retry, explicit CAPTCHA confirmation or manual completion is needed. The deferred video, existing size limits, pacing, and six-hour batch bound remain. Saved originals and partial progress survive retries.

This change records an observed operator workflow only; documentation changes require no build or container rollout.
