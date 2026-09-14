import { ActiveFilters } from 'javora-react';
import { filterOptions, activeFacets } from './_mocks';

export const Default = () => (
  <ActiveFilters facets={activeFacets} options={filterOptions} onToggle={() => {}} onReset={() => {}} />
);
