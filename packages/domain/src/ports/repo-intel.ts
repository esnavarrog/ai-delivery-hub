/** Read-only questions the hub asks about target repositories. */
export interface RepoIntelPort {
  headSha(repo: string, branch: string): Promise<string>;
  filesChangedSince(repo: string, sha: string, branch: string): Promise<string[]>;
}
