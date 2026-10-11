/** Query secrets and public portfolio bearer links must never enter request logs. */
export function privateRequestPath(url:string|undefined):string {
  return (url?.split(/[?#]/,1)[0] || '/').replace(/^(\/(?:api\/public\/portfolio|portfolio\/p)\/)[^/]+/,'$1[share]');
}
