export const brandDescription = 'An open-source graphical design tool for SysML v2'
export const brandPurpose = 'Create, visualize, edit and validate system models in your browser.'

/** One original vector asset for the workbench, README and browser icon. */
export default function BrandMark({ className = 'brand-mark', size = 32 }: { className?: string; size?: number }) {
  return <img className={className} src="/skyview.svg" width={size} height={size} alt="" aria-hidden="true" />
}

export function BrandIntro() {
  return <div className="brand-intro">
    <BrandMark className="brand-intro-mark" size={72} />
    <h1>SkyView</h1>
    <p className="brand-intro-description">{brandDescription}</p>
    <p className="brand-intro-purpose">{brandPurpose}</p>
  </div>
}
