import { OpenInEditorButton } from './OpenInEditorButton';
import { RepoSiteButton } from './RepoSiteButton';

type RepositoryLinksProps = {
  companyId: string;
  /** The folder the editor opens. */
  path: string;
  /** What opens in the editor, such as "hatstand" or "the copy of hatstand". */
  what: string;
  name: string;
  /** The page of the repository on its site, when it has one. */
  webUrl?: string;
};

/** The two places a repository opens in, as icons: the editor, and its page on GitHub or GitLab when it has one. */
export function RepositoryLinks({ companyId, path, what, name, webUrl }: RepositoryLinksProps) {
  return (
    <span className="repository-links">
      <OpenInEditorButton companyId={companyId} path={path} what={what} iconOnly />
      {webUrl && <RepoSiteButton name={name} webUrl={webUrl} />}
    </span>
  );
}
