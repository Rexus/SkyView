import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'

export interface StandardsIdentity {
 release: { release: string; specification: string; specificationStatus: string; releaseCommit: string }
 lockSHA256: string
 adapterSHA256: string
 state: string
 error?: string
 scope: string
}
export default function StandardsVersion({ onIdentity }: { onIdentity?: (info: StandardsIdentity | null) => void }) {
 const [info,setInfo]=useState<StandardsIdentity|null>(null)
 const [error,setError]=useState('')
 useEffect(()=>{
  let active=true
  const refresh=()=>{fetch('/api/standards',{cache:'no-store'}).then(async response=>{
   if(!response.ok)throw new Error('Version could not be verified')
   const value=await response.json() as StandardsIdentity
   if(!value.release?.release || !value.release.specification || !value.lockSHA256)throw new Error('Incomplete version information')
   if(active){setInfo(value);setError('')}
  }).catch(e=>{if(active){setInfo(null);setError(String(e.message))}})}
  refresh()
  window.addEventListener('focus',refresh)
  return ()=>{active=false;window.removeEventListener('focus',refresh)}
 },[])
 useEffect(() => onIdentity?.(info), [info, onIdentity])
 if (!info) return <span className="status-standard" title={error || 'Checking the SysML version'} data-testid="standards-version">
  {error ? 'SysML unavailable' : 'SysML…'}
 </span>
 const verified = info.state === 'verified'
 const state = verified ? 'Verified locally' : 'Checker unavailable'
 const release = info.release.release + (info.release.specificationStatus === 'preview' ? ' (preview)' : '')
 const label = `${info.release.specification} · ${release}`
 return <span className="status-standard" role="img" aria-label={`${label} · ${state}`} data-testid="standards-version"
  title={`${label} · ${state}\n${info.error ?? info.scope}\nRelease commit: ${info.release.releaseCommit}\nLock: ${info.lockSHA256}\nChecker adapter: ${info.adapterSHA256}`}>
  {info.release.specification.split(' / ')[0]} · {release}
  {!verified && <TriangleAlert className="status-warning" size={13} aria-hidden="true" />}
 </span>
}
