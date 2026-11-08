import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Snapshot } from '../../../shared/api';
import type { ClientReadiness } from '../../../shared/readiness';
import type { Company } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { useClientReadiness } from '../hooks/useClientReadiness';
import { api } from '../lib/api';
import { CLIENT_LINK_SUGGESTIONS } from '../lib/link-suggestions';
import { firstOpenStep, isStepDone, SETUP_STEPS, setupSteps, stepForItem, type SetupStepId } from '../lib/setup-steps';
import { AgentStep } from './AgentStep';
import { AssignedWork } from './AssignedWork';
import { ClientFiles } from './ClientFiles';
import { ActiveFolder } from './ActiveFolder';
import { CommitProtection } from './CommitProtection';
import { FileField } from './FileField';
import { AreaList } from './AreaList';
import { GitIdentityStep } from './GitIdentityStep';
import { GuidesStep } from './GuidesStep';
import { LinksEditor } from './LinksEditor';
import { IdentityStep } from './IdentityStep';
import { ProjectTable } from './ProjectTable';
import { ReadinessCard } from './ReadinessCard';
import { RepositoriesStep } from './RepositoriesStep';
import { SecretsSection } from './SecretsSection';
import { PlanningStep } from './PlanningStep';
import { SubdomainSuggestions } from './SubdomainSuggestions';

type SetupWizardProps = {
  snapshot: Snapshot;
  company: Company;
  onChanged: () => Promise<void>;
  onFinish: () => void;
  onOpenTask: (taskId: string) => Promise<void>;
  onOpenArea: (areaId: string) => void;
};

const STEP_TEXT: Record<SetupStepId, { title: string; why: string; used?: string; example?: string }> = {
  name: {
    title: 'Name and photo',
    why: 'This is how you recognize the client across Hatstand. The color and photo help you see at a glance whose work you are in.',
  },
  agent: {
    title: 'Which agent?',
    why: 'Agent accounts belong to you, so you can use your personal subscription or one from the company. This is the default for this client, and you can still change it on any task.',
    example: 'An account can also serve only this client, such as one its company pays for. Add it below. To share one with every client, add it in Settings.',
  },
  links: {
    title: 'Links of this client',
    why: 'Keep what you would ask for on your first day in one place: chat, tickets, code, documentation, and each environment or platform. Don’t paste passwords or tokens here, because this client’s agents can read these links.',
  },
  identity: {
    title: 'Who commits for this client?',
    why: 'Git can choose your name, email and account by folder. This sets it up for this client, so you and its agents commit with the right identity, without changing it by hand. Hatstand shows you what it will write before writing anything.',
    example: 'This covers GitHub identity. SSH keys and AWS profiles stay as you have them.',
  },
  repositories: {
    title: 'Where is the code?',
    why: 'Connect the company’s GitHub or GitLab and download its repositories, or use a folder you already have. A task with no repository starts in the main folder, so agents can work across repositories. If this client has no code, skip this step and add an area in the Areas step.',
  },
  areas: {
    title: 'Areas of this client',
    why: 'An area is a part of this client’s work, such as search or a mobile app. Each one keeps its own documents, links and tasks, and can own repositories or folders. Agents read its files in its tasks. A client with no code works from them.',
    example: 'Skip this step if all the work of this client is one thing.',
  },
  planning: {
    title: 'Client planning',
    why: 'The place for this client\u2019s plans, tickets, specs and decisions: work that should outlast a single task.',
    used: 'Every session can reach this folder, and agents save lasting work there. Task notes stay their working draft.',
    example: 'The default folder is private to this computer and has no git. To keep plans in git, create a repository here or choose your team\u2019s. Agents commit there only in planning and design tasks, and they do not push unless you ask.',
  },
  'llm-config': {
    title: 'LLM config',
    why: 'How the agent works for this client, across all its repositories: instructions, skills, agents, commands, hooks and MCP servers.',
    used: 'Hatstand gives it to the agent each time a session of this client starts, and never copies it into a repository.',
    example: 'It adds to your other config instead of replacing it: your global config, then this client, then each repository. Skills and agents from this folder show with its name as a prefix.',
  },
  knowledge: {
    title: 'Client knowledge',
    why: 'Documents the agent can read about this client: domain docs, architecture, schemas. Rules it must always follow go in the instructions of LLM config.',
    used: 'Every session can reach this folder, and the agent opens what it needs from where it is. Nothing is copied into a repository.',
    example: 'Keep this outside your repositories, so it cannot be committed by accident.',
  },
  keys: {
    title: 'Keys and tools',
    why: 'Each client has its own tokens for Jira, GitHub, GitLab and other tools. They are encrypted with your system keychain and reach agents only in this client’s sessions, so accounts never mix. You can import them from an env file.',
    example: 'With tracker keys, Hatstand can bring in the work assigned to you.',
  },
  protection: {
    title: 'Protect commits',
    why: 'One click covers every repository of this client. It adds a git pre-commit hook to each one, which blocks a commit containing keys, knowledge or LLM config from any client, whoever makes it. The check only stores hashes, and no AI is involved.',
    example: 'Run it again after adding repositories, or after keys or knowledge change.',
  },
  guides: {
    title: 'Task guides',
    why: 'A guide lists the steps of a kind of work, such as a PR review or a bug investigation. Each step writes its prompt in the terminal, and you decide when to send it and when to move on. Guides here belong to this client and stay outside git.',
    example: 'Customize makes a copy of a guide for this client and opens it, so you can change its steps. New tasks use your copy. A prompt can call a skill, and can use {task}, {ticket} and {link}. A step with "you" instead of "prompt" is one you do yourself.',
  },
  review: {
    title: 'Review',
    why: 'Pick any step to change it. This is also where you come back to change this client later.',
  },
};

export function SetupWizard(props: SetupWizardProps) {
  const { loaded, ...readiness } = useClientReadiness(props.snapshot, props.company);
  if (!loaded) return <main className="page wizard" />;
  return <SetupSteps {...props} readiness={readiness} />;
}

function SetupSteps({
  snapshot,
  company,
  onChanged,
  onFinish,
  onOpenTask,
  onOpenArea,
  readiness,
}: SetupWizardProps & { readiness: ClientReadiness }) {
  const steps = setupSteps(company);
  const [step, setStep] = useState(() => firstOpenStep(steps, readiness, company.origin));
  const { error, run } = useAction();
  const current = steps[step] ?? SETUP_STEPS[0];
  const currentStepLink = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentStepLink.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [step]);
  const text = STEP_TEXT[current.id];
  const isLast = step === steps.length - 1;
  const folders = snapshot.clientFolders[company.id];

  const save = (next: Company) =>
    run(async () => {
      await api.saveCompany(next);
      await onChanged();
    });
  const saveContext = (change: Partial<Company['context']>) =>
    void save({ ...company, context: { ...company.context, ...change } });

  const content: Record<SetupStepId, ReactNode> = {
    name: <IdentityStep company={company} onSave={save} onChanged={onChanged} />,
    agent: <AgentStep company={company} accounts={snapshot.accounts} onSave={save} />,
    links: <LinksEditor links={company.links} suggestions={CLIENT_LINK_SUGGESTIONS} onChange={(links) => void save({ ...company, links })} />,
    identity: <GitIdentityStep company={company} onChanged={onChanged} />,
    repositories: <RepositoriesStep company={company} defaultFolder={folders?.defaultRoot} onSave={save} onChanged={onChanged} />,
    areas: (
      <>
        <AreaList snapshot={snapshot} company={company} onChanged={onChanged} onOpenArea={onOpenArea} stayAfterAdding />
        <SubdomainSuggestions company={company} onSave={save} />
        {company.projects.length > 0 && <ProjectTable company={company} onSave={save} onChanged={onChanged} />}
      </>
    ),
    planning: (
      <>
        <PlanningStep company={company} defaultPath={folders?.planning} onSave={save} onChanged={onChanged} />
        <ClientFiles companyId={company.id} scope="planning" refreshKey={company.planning?.path ?? ''} onOpenTask={onOpenTask} />
      </>
    ),
    'llm-config': (
      <>
        <ActiveFolder
          companyId={company.id}
          section="llm-config"
          title="LLM config folder"
          hint="Hatstand created the default folder for you. Use a custom folder if you already have a plugin for this client. Only one is active: skills/<name>/SKILL.md, agents/ and commands/ inside it are what load."
          defaultPath={folders?.llmConfig}
          customPath={company.context.pluginDir}
          warnNotPlugin
          onChange={(pluginDir) => save({ ...company, context: { ...company.context, pluginDir } })}
        />
        <FileField
          label="Instructions"
          hint={
            snapshot.starterInstructions.includes(company.id)
              ? 'Hatstand created this starter file. It counts once you fill it in.'
              : 'Optional. A Markdown file the agent follows in every session for this client.'
          }
          addLabel="Choose instructions file"
          value={company.context.instructionsFile}
          onChange={(instructionsFile) => saveContext({ instructionsFile })}
          onOpen={() => void run(() => api.openClientFolder(company.id, 'instructions'))}
        />
        <FileField
          label="MCP servers"
          hint="Optional. An MCP config file used only in this client’s sessions."
          addLabel="Choose MCP config file"
          value={company.context.mcpConfigFile}
          onChange={(mcpConfigFile) => saveContext({ mcpConfigFile })}
        />
        <ClientFiles
          companyId={company.id}
          scope="llm-config"
          refreshKey={[company.context.instructionsFile, company.context.pluginDir].join('|')}
          onOpenTask={onOpenTask}
        />
      </>
    ),
    knowledge: (
      <>
        <ActiveFolder
          companyId={company.id}
          section="knowledge"
          title="Knowledge folder"
          hint="Hatstand created the default folder for you, outside any repository. Use a custom folder if you already keep these documents somewhere else. Only one is active."
          defaultPath={folders?.knowledge}
          customPath={company.context.knowledgeDir}
          warnInsideGit
          onChange={(knowledgeDir) => save({ ...company, context: { ...company.context, knowledgeDir } })}
        />
        <ClientFiles companyId={company.id} scope="knowledge" refreshKey={company.context.knowledgeDir ?? ''} onOpenTask={onOpenTask} />
      </>
    ),
    keys: (
      <>
        <SecretsSection companyId={company.id} />
        <AssignedWork companyId={company.id} onChanged={onChanged} />
      </>
    ),
    protection: <CommitProtection companyId={company.id} />,
    guides: <GuidesStep company={company} onSave={save} onOpenTask={onOpenTask} />,
    review: <ReadinessCard readiness={readiness} onOpenItem={(item) => setStep(stepForItem(steps, item))} />,
  };

  const stepDone = isStepDone(current.itemIds, readiness);
  const defaultFolder = { repositories: folders?.defaultRoot, knowledge: folders?.knowledge, 'llm-config': folders?.llmConfig }[current.id as string];
  const acceptsFolder = !stepDone && Boolean(defaultFolder);
  const needsWork = current.itemIds.length > 0 && !stepDone && !acceptsFolder;

  const goForward = () => {
    if (!acceptsFolder) {
      setStep(step + 1);
      return;
    }
    void run(async () => {
      if (current.id === 'repositories') await api.resetClientFolder(company.id);
      else await api.saveCompany({ ...company, confirmedSteps: [...company.confirmedSteps, current.id] });
      await onChanged();
      setStep(step + 1);
    });
  };

  return (
    <main className="page wizard">
      <div className="wizard-body">
        <nav aria-label="Setup steps">
          <ol className="wizard-steps">
            {steps.map((item, index) => (
              <li key={item.id}>
                <button
                  className="wizard-step-link"
                  ref={index === step ? currentStepLink : undefined}
                  aria-current={index === step ? 'step' : undefined}
                  onClick={() => setStep(index)}
                >
                  <span className="wizard-number">
                    {isStepDone(item.itemIds, readiness) ? <Check size={14} /> : index + 1}
                  </span>
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="wizard-content" aria-labelledby="wizard-title">
          <h2 id="wizard-title">{text.title}</h2>
          <p className="wizard-why">{text.why}</p>
          {text.used && <p className="wizard-why">{text.used}</p>}
          {text.example && <p className="hint">{text.example}</p>}
          {error && <p className="error">{error}</p>}
          <div className="wizard-fields">{content[current.id]}</div>
          {acceptsFolder && current.id === 'repositories' && <p className="hint">Continue uses the default folder: {defaultFolder}</p>}
          <footer className="wizard-actions">
            <button className="quiet" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </button>
            {isLast ? (
              <button onClick={onFinish}>Go to tasks</button>
            ) : (
              <button className={needsWork ? 'quiet' : undefined} onClick={goForward}>
                {needsWork ? 'Skip for now' : 'Continue'}
              </button>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}
