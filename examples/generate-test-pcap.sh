#!/bin/bash

echo "Generating test PCAP file..."
echo "This will capture 100 packets"
echo ""
echo "Press Ctrl+C to stop early"
echo ""

OUTPUT_FILE="test-capture.pcap"

if command -v gtimeout &> /dev/null; then
    sudo gtimeout 30 tcpdump -c 100 -w "$OUTPUT_FILE"
else
    sudo tcpdump -c 100 -w "$OUTPUT_FILE"
fi

if [ -f "$OUTPUT_FILE" ]; then
    echo ""
    echo "✓ PCAP file created: $OUTPUT_FILE"
    echo "File size: $(ls -lh $OUTPUT_FILE | awk '{print $5}')"
    echo ""
    echo "To view contents:"
    echo "  tcpdump -r $OUTPUT_FILE"
    echo ""
    echo "To use with Pew Map:"
    echo "  1. Start the server: sudo npm start"
    echo "  2. Select 'PCAP File' in the UI"
    echo "  3. Enter path: $(pwd)/$OUTPUT_FILE"
else
    echo "Failed to create PCAP file"
    exit 1
fi
