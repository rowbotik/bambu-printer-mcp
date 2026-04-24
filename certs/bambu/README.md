# Bambu Client Certificates

Put optional Bambu-issued client certificates for mTLS here:

- `embedded-cert.pem`
- `embedded-key.pem`

These credential files are ignored by git. The server uses this directory by default, and `BAMBU_CLIENT_CERT` / `BAMBU_CLIENT_KEY` can override the paths when needed.
