#!/usr/bin/env bash
# Install the morning ops run on this Mac (launchd). Re-run after editing the plist.
set -euo pipefail
cd "$(dirname "$0")"
cp com.kaniti.ops.plist "$HOME/Library/LaunchAgents/com.kaniti.ops.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.kaniti.ops.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.kaniti.ops.plist"
echo "installed: com.kaniti.ops runs ops/repair.sh daily at 06:40; run now with: launchctl start com.kaniti.ops"
