export default function UnsavedDot({ label }: { label?: string }) {
  return <span className="unsaved-dot" role={label ? 'img' : undefined}
    aria-label={label} title={label} aria-hidden={label ? undefined : true} />
}
