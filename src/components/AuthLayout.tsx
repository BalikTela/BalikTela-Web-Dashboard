import { LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import { AuthBranding } from './AuthBranding';
import balikTelaLogo from '../assets/auth/baliktelaph.png';
import textileStudy from '../assets/auth/textile-study.jpg';

const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-workspace" aria-label="BalikTelaPH account access">
        <header className="auth-workspace-header">
          <img className="auth-primary-logo" src={balikTelaLogo} alt="BalikTelaPH" width={1254} height={1254} decoding="async" draggable={false} />
          <span className="auth-secure-label"><LockKeyhole size={14} aria-hidden="true" />Secure access</span>
        </header>
        <div className="auth-workspace-content">{children}</div>
        <footer className="auth-workspace-footer"><AuthBranding /></footer>
      </section>
      <figure className="auth-visual">
        <picture>
          <source media="(min-width: 1024px)" srcSet={textileStudy} />
          <img src={transparentPixel} width={1122} height={1402} alt="Illustrative textile study of denim, cotton, and fabric offcuts." decoding="async" />
        </picture>
        <figcaption className="auth-visual-caption">
          <div><p>Circular Textile Network</p><span>BalikTelaPH</span></div>
          <span className="auth-image-disclosure">Illustrative material study</span>
        </figcaption>
      </figure>
    </main>
  );
}
