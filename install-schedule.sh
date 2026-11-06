#!/bin/bash
# Installs a LaunchAgent that runs the digest at 22:00, the night before.
# If the Mac is asleep at 22:00, launchd runs it on next wake.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(which node)"
PLIST="$HOME/Library/LaunchAgents/com.classroom-digest.plist"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.classroom-digest</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/src/index.js</string>
    <string>digest</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>22</integer><key>Minute</key><integer>0</integer></dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$DIR/data/digest.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/digest.err.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. Runs daily at 22:00 (digest describes the next day)."
echo "Logs: $DIR/data/digest.log  and  digest.err.log"
echo "Remove with: launchctl unload $PLIST && rm $PLIST"
