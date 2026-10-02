#!/bin/sh
set -eu
# Share the backend byte limit; reject zero, which Nginx treats as unlimited.
: "${STUDYDY_UPLOAD_MAX_BYTES:=104857600}"
case "$STUDYDY_UPLOAD_MAX_BYTES" in ''|*[!0-9]*) exit 1 ;; esac
[ "$STUDYDY_UPLOAD_MAX_BYTES" -ge 1 ] && [ "$STUDYDY_UPLOAD_MAX_BYTES" -le 104857600 ]
export STUDYDY_UPLOAD_MAX_BYTES
envsubst '${STUDYDY_UPLOAD_MAX_BYTES}' < /etc/nginx/studydy.conf.template > /tmp/studydy.conf
sed 's@include /etc/nginx/conf.d/\*.conf;@include /tmp/studydy.conf;@' /etc/nginx/nginx.conf > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
