# Deployment Guide: Teen Passbook

This guide covers deploying the Teen Passbook PWA to GitHub Pages.

## Prerequisites

- GitHub account
- Repository with push access
- Node.js 20+ installed locally (for testing)

## GitHub Pages Deployment

### 1. Configure Repository

1. Go to your repository settings
2. Navigate to **Pages** section
3. Set source to **GitHub Actions**

### 2. Set Base Path (if needed)

If deploying to a subdirectory (e.g., `username.github.io/passbook`):

1. Create `frontend/.env.production` file:
```bash
VITE_BASE_PATH=/passbook/
```

2. Or set as environment variable in GitHub Actions

For root deployment (e.g., custom domain), use:
```bash
VITE_BASE_PATH=/
```

### 3. Deploy

The GitHub Actions workflow (`.github/workflows/deploy.yml`) will automatically:

1. Build the React app on push to `main`
2. Deploy to GitHub Pages
3. Update on every push

To manually trigger:
1. Go to **Actions** tab
2. Select **Deploy to GitHub Pages** workflow
3. Click **Run workflow**

### 4. Access Your App

- Subdirectory: `https://[username].github.io/passbook/`
- Root: `https://[username].github.io/` (if configured)
- Custom domain: As configured in GitHub Pages settings

## Custom Domain Setup

1. Add `CNAME` file to `frontend/public/` with your domain:
```
your-domain.com
```

2. Configure DNS:
   - Add CNAME record pointing to `[username].github.io`
   - Or A records pointing to GitHub Pages IPs

3. Update in GitHub Pages settings → Custom domain

## Local Testing

Test the production build locally:

```bash
cd frontend
npm run build
npm run preview
```

## Troubleshooting

### Build Fails

- Check Node.js version (requires 20+)
- Verify all dependencies installed: `npm ci`
- Check for TypeScript errors: `npm run build`

### 404 Errors After Deployment

- Verify `VITE_BASE_PATH` matches your deployment path
- Check that routes use relative paths
- Ensure React Router uses correct basename

### PWA Not Installing

- Verify HTTPS (required for PWA)
- Check `manifest.webmanifest` is accessible
- Ensure service worker is registered

### Assets Not Loading

- Verify base path in `vite.config.ts`
- Check that public assets are in `public/` directory
- Ensure GitHub Pages serves from correct directory

## Continuous Deployment

Every push to `main` automatically triggers:
1. Build → Test → Deploy
2. Artifact upload to GitHub Pages
3. Automatic site update

No manual steps required after initial setup!

