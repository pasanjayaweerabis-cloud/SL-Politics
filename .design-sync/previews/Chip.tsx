import { Chip } from 'javora-react';

export const Plain = () => <Chip text="Cabinet Minister" />;
export const WithIcon = () => <Chip text="Colombo" iconName="mapPin" />;
export const Gold = () => <Chip text="National People’s Power" variant="gold" />;
export const Muted = () => <Chip text="Former" variant="muted" />;
