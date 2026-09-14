import { Avatar } from 'javora-react';
import { currentMinisterView, cabinetMinisterView, formerMemberView } from './_mocks';

export const Default = () => <Avatar view={currentMinisterView} />;
export const Small = () => <Avatar view={cabinetMinisterView} size="sm" />;
export const Large = () => <Avatar view={formerMemberView} size="lg" />;
