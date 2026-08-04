# Palo Alto NGFW Threat CSV

`pew-map` accepts CSV exports of Palo Alto NGFW Threat logs. The file is read line by line so large exports do not need to fit in process memory.

This mode does not depend on the native `pcap` binding. The server can process Palo Alto CSV exports even when live packet capture and PCAP replay are unavailable.

## Required columns

| CSV column | Map use |
| --- | --- |
| `Source Address` | Arc source IP |
| `Destination Address` | Arc destination IP |
| `Severity` | Threat color and level |

## Optional columns

| CSV column | Map use |
| --- | --- |
| `Time Generated` | Feed timestamp; uses replay time if it cannot be parsed |
| `Threat Name Firewall` | Threat description |
| `Threat Category` | Feed badge |
| `Subtype` | Classification metadata |
| `Application` | TCP/UDP inference when recognizable |
| `Action` | Feed action badge |
| `Rule` | Preserved in connection metadata |
| `Direction Of Attack` | Preserved in connection metadata |
| `Destination Port` | Preserved in connection metadata |

The parser supports normal CSV escaping, including doubled quotes and comma-bearing quoted values. It rejects malformed rows with a different number of fields than the header.

Rows are replayed in accelerated batches rather than at their original log timing. The parser yields to the event loop after every 250 valid rows so WebSocket delivery and map rendering remain responsive during large imports.

Private RFC 1918 endpoints use `HOME_LATITUDE`, `HOME_LONGITUDE`, and the related home-location settings. Rows whose source and destination are both private cannot form a geographic route and are not rendered.

Rows whose `Destination Address` is `172.16.16.16` or `172.16.16.17` are excluded before geolocation and rendering.

Informational rows whose `Threat Category` is `info-leak` or `unknown` are also excluded before geolocation and rendering. Severity and category matching are case-insensitive.
