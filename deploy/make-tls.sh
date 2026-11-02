#!/usr/bin/env bash
set -euo pipefail
host=${1:-43.160.215.253}
[[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || { echo 'Invalid host';exit 1; }
dest=/etc/voxi/tls
install -d -m 700 "$dest"
if [[ -f "$dest/server.key" || -f "$dest/ca.key" ]]; then
  echo 'Existing certificate found; preserving it';exit 0
fi
umask 077
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
  -keyout "$dest/ca.key" -out "$dest/ca.crt" -subj '/CN=Voxi Device Root CA' \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
openssl req -new -newkey rsa:2048 -nodes -keyout "$dest/server.key" \
  -out "$dest/server.csr" -subj "/CN=$host"
kind=DNS
[[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && kind=IP
printf 'subjectAltName=%s:%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$kind" "$host" > "$dest/server.ext"
openssl x509 -req -in "$dest/server.csr" -CA "$dest/ca.crt" -CAkey "$dest/ca.key" \
  -CAcreateserial -out "$dest/server.crt" -days 825 -sha256 -extfile "$dest/server.ext"
echo "Root CA for firmware (public certificate): $dest/ca.crt"
