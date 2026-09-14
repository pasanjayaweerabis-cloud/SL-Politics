import { FilterSidebar } from 'javora-react';
import { filterOptions, activeFacets, emptyFacets } from './_mocks';

export const WithActiveFilters = () => (
  <FilterSidebar facets={activeFacets} options={filterOptions} onToggle={() => {}} onReset={() => {}} />
);
export const NoFiltersApplied = () => (
  <FilterSidebar facets={emptyFacets} options={filterOptions} onToggle={() => {}} onReset={() => {}} />
);
