#!/bin/sh

echo "Starting entrypoint script..."

PRISMA="/opt/app/node_modules/.bin/prisma"

if [ "${XBOARD_SKIP_DB_BOOTSTRAP:-0}" = "1" ]; then
    echo "Skipping database migration and seeding for a schema-compatible Xboard update."
else
    echo "Migrating database..."
    if ! "$PRISMA" migrate deploy; then
        echo "Database migration failed! Exiting container..."
        exit 1
    fi

    echo "Migrations deployed successfully!"

    echo "Seeding database..."
    if ! "$PRISMA" db seed; then
        echo "Database seeding failed! Exiting container..."
        exit 1
    fi
fi

echo "Entrypoint script completed."
exec "$@"
