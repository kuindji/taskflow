# Section 7 review triage

Codex review (`impl-7.md`, base 5c97d18b): no findings.

Own findings:
- confirmed (minor): a heartbeat sent before a new tab's first load commits reports `url: ""`; the service stored and saved it, so `browser list` right after `open` showed `url: ""`, and a quit in that window would save an empty url. Seen in the Step 6c smoke run. Fixed in 2286b550: the heartbeat keeps the known url when the view reports none.
