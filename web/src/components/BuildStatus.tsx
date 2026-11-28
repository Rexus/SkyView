import { useState } from 'react'
import { ChevronUp, Copy } from 'lucide-react'
import { deploymentLabel, type AboutInfo } from '../about'
import type { StandardsIdentity } from './StandardsVersion'

function releaseLabel(info: AboutInfo['build']) {
  if (info.official) {
    const labels: Record<string, string> = {
      stable: 'Official release',
      alpha: 'Official alpha',
      beta: 'Official beta',
      rc: 'Official release candidate',
    }
    return labels[info.channel] ?? 'Official prerelease'
  }
  return info.channel === 'stable' || info.channel === 'unknown'
    ? 'Unofficial build'
    : 'Unofficial build · ' + info.channel + ' base'
}

export default function BuildStatus({ about, unavailable, standards, modelRevision }: {
  about: AboutInfo | null
  unavailable: boolean
  standards: StandardsIdentity | null
  modelRevision?: string
}) {
  const [message, setMessage] = useState('')
  const [manualCopy, setManualCopy] = useState(false)
  if (!about) return <>
    <span title={unavailable ? 'Build information unavailable' : 'Loading build information'}>{unavailable ? 'Build unavailable' : 'Build…'}</span>
    <span className="build-copyright">© SkyView</span>
  </>

  const { build } = about
  const info = {
    build,
    deployment: about.mode,
    sysml: standards ? {
      release: standards.release.release,
      specification: standards.release.specification,
      releaseCommit: standards.release.releaseCommit,
      lockSHA256: standards.lockSHA256,
      adapterSHA256: standards.adapterSHA256,
      checkerState: standards.state,
    } : null,
    modelRevision,
  }
  const report = JSON.stringify(info, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setMessage('Build report copied')
    } catch {
      setManualCopy(true)
      setMessage('Select and copy the build report')
    }
  }
  return <>
    <details className="build-status" onToggle={e => { if (!e.currentTarget.open) { setMessage(''); setManualCopy(false) } }}>
      <summary className="build-status-summary" aria-label={`Build information · ${build.version} · ${releaseLabel(build)}`}
        title={`${build.version} · ${releaseLabel(build)}`}>
        <span>{build.version}</span>
        {!build.official && <span className="build-channel">dev</span>}
        <ChevronUp size={11} aria-hidden="true" />
      </summary>
      <div className="build-status-panel">
        <strong>SkyView {build.version}</strong>
        <dl>
          <dt>Build</dt><dd>{releaseLabel(build)}</dd>
          <dt>Deployment</dt><dd>{deploymentLabel(about.mode)}</dd>
          <dt>Source revision</dt><dd className="mono">{build.revision ?? 'Unknown'}</dd>
          <dt>Source state</dt><dd>{build.sourceState}</dd>
          {modelRevision && <><dt>Model revision</dt><dd className="mono">{modelRevision}</dd></>}
          {standards && <>
            <dt>Specification</dt><dd>{standards.release.specification} · {standards.release.release}</dd>
            <dt>Checker</dt><dd>{standards.state === 'verified' ? 'Verified locally' : standards.error ?? 'Unavailable'}</dd>
          </>}
          {build.tag && <><dt>Release tag</dt><dd><a href={build.repository + '/releases/tag/' + encodeURIComponent(build.tag)} target="_blank" rel="noreferrer">{build.tag}</a></dd></>}
          <dt>Runtime</dt><dd>{build.platform} · {build.goVersion}</dd>
          <dt>Executable SHA-256</dt><dd className="mono">{build.executableSHA256 ?? 'Unavailable'}</dd>
        </dl>
        <p className="build-attribution">{build.copyright} · {build.license}</p>
        <button className="btn btn-sm" type="button" onClick={() => void copy()}><Copy size={13} /> Copy build report</button>
        <span className="build-copy-feedback" role="status">{message}</span>
        {manualCopy && <textarea className="textarea mono" aria-label="Build report" rows={6}
          value={report} readOnly autoFocus onFocus={e => e.target.select()} />}
      </div>
    </details>
    <a className="build-copyright" href={build.repository} target="_blank" rel="noreferrer" title={build.copyright + ' · ' + build.license}>
      © SkyView
    </a>
  </>
}
