import type { Company } from './schemas';
import { workRepositories } from './work-repos';

export type ReadinessLevel = 'required' | 'recommended' | 'optional';

export type ReadinessItem = {
  id: string;
  label: string;
  hint: string;
  level: ReadinessLevel;
  section: string;
  done: boolean;
};

export type ClientReadiness = {
  items: ReadinessItem[];
  percent: number;
  canStart: boolean;
};

export type ReadinessInput = {
  company: Company;
  secretNames: string[];
  hasLocalKnowledge: boolean;
  hasLocalPlugin: boolean;
  hasStarterInstructions: boolean;
};

const ownAreas = (company: Company) => company.subdomains.filter((area) => area.id !== company.defaultAreaId);

export function hasWorkspace(company: Company): boolean {
  const areas = company.hasCode ? ownAreas(company) : company.subdomains;
  return Boolean(company.rootDir) || company.projects.length > 0 || areas.length > 0;
}

function hasTracker(names: string[]): boolean {
  const has = (name: string) => names.includes(name);
  const jira = has('JIRA_SITE') && has('JIRA_EMAIL') && has('JIRA_API_TOKEN');
  return jira || has('GITHUB_TOKEN') || has('GH_TOKEN') || has('GITLAB_TOKEN');
}

function isProtected(company: Company): boolean {
  const repos = workRepositories(company);
  return repos.length > 0 && repos.every((project) => company.protectedPaths.includes(project.path));
}

export function clientReadiness({
  company,
  secretNames,
  hasLocalKnowledge,
  hasLocalPlugin,
  hasStarterInstructions,
}: ReadinessInput): ClientReadiness {
  const { context } = company;
  const items: ReadinessItem[] = [
    {
      id: 'workspace',
      label: company.hasCode ? 'Add an area, a repository or a client folder' : 'Add an area or a client folder',
      hint: 'Agents need a place to work. This is the only step you need before starting.',
      level: 'required',
      section: 'section-projects',
      done: hasWorkspace(company),
    },
    {
      id: 'knowledge',
      label: 'Add knowledge',
      hint: 'Agents can read the documents they need about this client.',
      level: 'recommended',
      section: 'section-knowledge',
      done: Boolean(context.knowledgeDir) || hasLocalKnowledge || company.confirmedSteps.includes('knowledge'),
    },
    {
      id: 'llm-config',
      label: 'Set up the LLM config',
      hint: 'Instructions, skills, agents and MCP servers that agents use in every session of this client.',
      level: 'recommended',
      section: 'section-knowledge',
      done:
        (Boolean(context.instructionsFile) && !hasStarterInstructions) ||
        Boolean(context.pluginDir) ||
        hasLocalPlugin ||
        company.confirmedSteps.includes('llm-config'),
    },
    {
      id: 'tracker',
      label: 'Connect Jira, GitHub or GitLab',
      hint: 'Add JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN, or GITHUB_TOKEN, or GITLAB_TOKEN, to import your assigned work.',
      level: 'recommended',
      section: 'section-keys',
      done: hasTracker(secretNames),
    },
    ...(workRepositories(company).length > 0
      ? [
          {
            id: 'protection',
            label: 'Protect every repository',
            hint: 'Blocks commits that contain client keys or knowledge.',
            level: 'recommended' as const,
            section: 'section-protection',
            done: isProtected(company),
          },
        ]
      : []),
    ...(company.projects.length > 0
      ? [
          {
            id: 'identity',
            label: 'Choose who commits for this client',
            hint: 'Commits in this client’s folder use the right name, email and GitHub user.',
            level: 'recommended' as const,
            section: 'section-identity',
            done: Boolean(company.gitIdentity?.appliedAt),
          },
        ]
      : []),
    {
      id: 'links',
      label: 'Add the client’s links',
      hint: 'Slack, Jira, GitHub, production and anything else you open often.',
      level: 'optional',
      section: 'section-links',
      done: company.links.length > 0,
    },
    {
      id: 'subdomains',
      label: 'Group work into areas',
      hint: 'Useful when this client has many repositories.',
      level: 'optional',
      section: 'section-projects',
      done: ownAreas(company).length > 0,
    },
    {
      id: 'photo',
      label: 'Add a photo',
      hint: 'Helps you spot this client quickly.',
      level: 'optional',
      section: 'section-workspace',
      done: Boolean(company.photo),
    },
  ];
  const counted = items.filter((item) => item.level !== 'optional');
  return {
    items,
    percent: Math.round((counted.filter((item) => item.done).length / counted.length) * 100),
    canStart: hasWorkspace(company),
  };
}
