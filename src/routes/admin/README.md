# Admin System

This directory contains the admin functionality for Blissbase.

## Features

- **Secret Admin Endpoint**: Access via `/admin/secret/{ADMIN_SECRET_UUID}` to set admin cookie
- **Admin Cookie Authentication**: Secure HTTP-only cookie with 7-day expiration
- **Event Management**: Delete events with admin privileges
- **Admin UI**: Admin section appears at bottom of event details for authenticated admins

## Setup

1. Set the `ADMIN_SECRET_UUID` environment variable to your secret UUID
2. Visit `/admin/secret/{your-secret-uuid}` to authenticate as admin
3. Admin controls will now appear at the bottom of event detail pages

## Security

- Admin authentication uses HTTP-only, secure cookies
- Secret UUID should be kept confidential
- All admin operations are logged and require valid authentication
- Cookies expire after 7 days for security

## Usage

1. **Authenticate**: GET `/admin/secret/{ADMIN_SECRET_UUID}`
2. **Delete Event**: Use delete button in admin section of event details
3. **Check Status**: Admin status is automatically checked on event detail pages

## Environment Variables

- `ADMIN_SECRET_UUID`: Secret UUID for admin authentication (required for production)
