# Changelog

## Unreleased

### Added

- Palo Alto NGFW Threat CSV replay support, including streamed CSV parsing, threat-severity coloring, map normalization, and a dedicated data-source selector.
- Destination filtering for `172.16.16.16` and `172.16.16.17` across FTD and Palo Alto threat logs.

### Changed

- Pace sampled connections individually in arrival order and fade map routes for smoother live visualization. During sustained bursts, the visual queue retains the most recent 50 samples while the connection total and rate count all received events.

- Cisco FTD syslog parsing recognizes JSON `message_id` and `EventPriority` fields in current connection events, while preserving legacy syslog headers and private-to-OpenDNS direction.

- Informational Palo Alto Threat rows in the `info-leak` and `unknown` categories are excluded before map processing.
- The native `pcap` binding is loaded only for Live Capture and PCAP File sources, allowing FTD syslog and Palo Alto CSV modes to start when packet capture is unavailable.
- Palo Alto Threat CSV replay now runs in accelerated, cooperative batches instead of waiting 80 ms after each row.
