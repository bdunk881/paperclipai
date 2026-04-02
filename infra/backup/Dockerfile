# ==============================================================================
# AutoFlow DB Backup Image
#
# Base: postgres:16-alpine (includes pg_dump, pg_restore, psql)
# Adds: AWS CLI v2, curl
# ==============================================================================
FROM postgres:16-alpine

# Install AWS CLI (v2 not available on Alpine via apk; install awscli v1 which
# is sufficient for s3 cp/ls/rm) and curl. Use --no-cache to keep the image lean.
RUN apk add --no-cache \
      aws-cli \
      curl \
      bash \
  && aws --version \
  && curl --version

# Copy and make backup script executable
COPY db-backup.sh /backup/db-backup.sh
RUN chmod +x /backup/db-backup.sh

# Run as non-root user for least-privilege operation
RUN addgroup -S backup && adduser -S backup -G backup
USER backup

# Health check: verify pg_dump binary is available
HEALTHCHECK --interval=30s --timeout=10s --retries=1 \
  CMD pg_dump --version || exit 1

CMD ["/backup/db-backup.sh"]
