import { SearchBar } from 'javora-react';

export const Default = () => <SearchBar placeholder="Search by name, party, district or role" label="Search records" />;
export const WithValue = () => <SearchBar value="Anura" placeholder="Search by name" label="Search records" />;
export const Compact = () => <SearchBar compact placeholder="Search" label="Search records" submitButton={false} />;
