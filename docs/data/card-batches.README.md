# Handout batches

Edit `card-batches.json` by hand when a batch of cards goes out. The map reads this file. Leave `batches` empty until there is a real handout. Day of week is not stored; the map derives it from each `YYYY-MM-DD` date.

`meta.updatedAt` is an ISO timestamp you set when you change the file, or `null` if you have not yet.

Each object in `batches` uses these fields:

| Field | Meaning |
| --- | --- |
| `id` | Short id, such as `"B01"`. |
| `cardFrom` | First card id, inclusive, such as `"C001"`. |
| `cardTo` | Last card id, inclusive, such as `"C100"`. |
| `place` | Where the cards were handed out, such as `"Capitol Square"`. |
| `lat` | Pin latitude. |
| `lng` | Pin longitude. |
| `dates` | Array of calendar dates, `"YYYY-MM-DD"`. |
| `handedOut` | How many cards were actually handed out. |
| `inProgressStarts` | New Robinhood signups that reached **In progress** from this batch. You enter this number; it does not come from scan counts. |
| `notes` | Optional free text. Use `""` if you have nothing to add. |

Conversion rate is `inProgressStarts / handedOut`. Scan counts for the card range come from the live Mantle totals.

Example shape only. Do not copy this into the live file unless the handout really happened:

```json
{
  "id": "B01",
  "cardFrom": "C001",
  "cardTo": "C100",
  "place": "Capitol Square",
  "lat": 43.0746,
  "lng": -89.384,
  "dates": ["2026-09-26"],
  "handedOut": 100,
  "inProgressStarts": 0,
  "notes": ""
}
```
