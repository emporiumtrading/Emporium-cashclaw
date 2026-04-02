#!/bin/sh
if [ -n "$FLY_APP_NAME" ]; then
  mkdir -p /data/melista /data/moltlaunch
  rm -rf /root/.moltlaunch
  ln -sf /data/moltlaunch /root/.moltlaunch
  rm -rf /root/.melista
  ln -sf /data/melista /root/.melista
fi
exec node dist/index.js
