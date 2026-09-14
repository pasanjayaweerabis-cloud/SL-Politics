import { Tabs } from 'javora-react';

const tabs = [
  { id: 'career', label: 'Political Career', icon: 'building' },
  { id: 'qualifications', label: 'Qualifications', icon: 'bookOpen' },
  { id: 'sources', label: 'Sources', icon: 'link' },
];

export const Default = () => <Tabs tabs={tabs} active="career" onChange={() => {}} label="Profile sections" />;
