#!/usr/bin/with-contenv bashio
# Perch at a Glance — add-on entrypoint.
# Reads options from /data/options.json (Supervisor-managed) and starts the
# Node server. Secrets are passed as environment variables only; nothing is
# written to disk outside /data, and no token is ever logged.

bashio::log.info "Starting Perch at a Glance..."
bashio::log.info "Node: $(node --version)"

export PERCH_PORT="$(bashio::config 'port')"
export PERCH_TIMEZONE="$(bashio::config 'timezone')"
# Default viewer (trevor|leslie). Theme follows the viewer and is
# configurable per viewer (see config.yaml): Trevor -> dark (leading option
# northdatum-dark; pine is one candidate), Leslie -> blush (light).
export PERCH_DEFAULT_VIEWER="$(bashio::config 'default_viewer')"
export PERCH_THEME_TREVOR="$(bashio::config 'theme_trevor')"
export PERCH_THEME_LESLIE="$(bashio::config 'theme_leslie')"
export PERCH_HA_TOKEN="$(bashio::config 'ha_token')"
export PERCH_FEED_TOKEN_SKIPPER="$(bashio::config 'feed_token_skipper')"
export PERCH_FEED_TOKEN_AMANDA="$(bashio::config 'feed_token_amanda')"

if bashio::config.true 'open_meteo_enabled'; then
  export PERCH_OPEN_METEO_ENABLED="1"
else
  export PERCH_OPEN_METEO_ENABLED="0"
fi

# The Supervisor persists /data across restarts and updates.
export PERCH_DATA_DIR="/data"

bashio::log.info "Listening on port ${PERCH_PORT} (timezone ${PERCH_TIMEZONE})"
exec node /app/server.js
