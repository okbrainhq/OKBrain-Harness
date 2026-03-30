import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OKBrain',
    short_name: 'OKBrain',
    description: 'Your Personal AI Assistant',
    start_url: '/',
    display: 'standalone',
    background_color: '#343541',
    theme_color: '#343541',
    icons: [
      {
        src: '/okbrain-icon.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    screenshots: [
      {
        src: '/screenshot-mobile.png',
        sizes: '1080x1920',
        type: 'image/png',
      },
      {
        src: '/screenshot-desktop.png',
        sizes: '1920x1080',
        type: 'image/png',
        // @ts-ignore
        form_factor: 'wide',
      },
    ],
  }
}
