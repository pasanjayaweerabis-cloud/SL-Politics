import { ProfileCard } from 'javora-react';
import { currentMinisterView, formerMemberView } from './_mocks';

export const Current = () => <ProfileCard view={currentMinisterView} />;
export const Former = () => <ProfileCard view={formerMemberView} />;
