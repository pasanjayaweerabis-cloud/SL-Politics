import { Layout } from 'javora-react';

export const Default = () => (
  <Layout route={{ name: 'directory', params: {} }}>
    <div className="container" style={{ padding: '2rem 0' }}>
      <h1>Directory</h1>
      <p>Page content renders here, between the nav and the footer.</p>
    </div>
  </Layout>
);
