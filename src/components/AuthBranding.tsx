import dostLogo from '../assets/auth/dost.jpg';
import pchrdLogo from '../assets/auth/pchrd.png';
import nuLogo from '../assets/auth/national-university.png';

const logos = [
  { id: 'dost', name: 'DOST - Department of Science and Technology', src: dostLogo, width: 1000, height: 1000 },
  { id: 'pchrd', name: 'PCHRD - Philippine Council for Health Research and Development', src: pchrdLogo, width: 4000, height: 2000 },
  { id: 'nu', name: 'NU - National University', src: nuLogo, width: 1920, height: 1080 },
];

export function AuthBranding() {
  return (
    <div className="auth-branding" role="group" aria-label="BalikTelaPH institutions">
      <ol className="auth-branding-list" aria-label="Institution logos">
        {logos.map(logo => (
          <li key={logo.id} className={`auth-branding-item auth-branding-item--${logo.id}`}>
            <div className={`auth-branding-image auth-branding-image--${logo.id}`}>
              <img src={logo.src} alt={logo.name} width={logo.width} height={logo.height} decoding="async" draggable={false} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
