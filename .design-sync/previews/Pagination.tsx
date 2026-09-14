import { Pagination } from 'javora-react';

export const HasMore = () => <Pagination page={{ total: 837, shown: 24, hasMore: true, perPage: 24 }} onMore={() => {}} />;
export const AllShown = () => <Pagination page={{ total: 24, shown: 24, hasMore: false, perPage: 24 }} onMore={() => {}} />;
