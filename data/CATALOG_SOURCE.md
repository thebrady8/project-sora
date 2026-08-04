# Project Sora catalog source

This build contains exactly **16,500 game/platform records**—an increase of **11,500** over the previous 5,000-record build.

- The original six curated Project Sora records are preserved first.
- Remaining records are selected by reported global sales from the bundled `vgsales.csv` source and normalized into stable game/platform records.
- Imported factual fields: title, platform, release year, genre, publisher, and reported global sales.
- **MSRP, current price, cover art, critic score, and barcode data were not invented.** Those fields remain unavailable unless supplied by a licensed live provider or a verified manual update.
- A neutral placeholder image is used for imported entries.
- Duplicate title/platform/year rows are removed and catalog IDs are unique.

Source URL used for this catalog build:
`https://raw.githubusercontent.com/raghav-19/Video-Games-Sales-Data-Analysis/master/vgsales.csv`

Coverage is strongest for established console and PC releases through approximately 2016. For newer releases, verified covers, UPC/EAN values, MSRP, and live pricing, connect Project Sora to a licensed provider such as RAWG, IGDB, or another authorized catalog service and comply with its attribution and usage terms.
