import { Drawer } from 'javora-react';

export const Open = () => (
  <Drawer open onClose={() => {}} id="ds-drawer" label="Menu">
    <div className="drawer__head">
      <span className="brand__name">SL Politics</span>
    </div>
    <div className="drawer__body">
      <a href="/" className="drawer__link">Home</a>
      <a href="/government" className="drawer__link">Current Government</a>
      <a href="/directory" className="drawer__link">Directory</a>
    </div>
  </Drawer>
);
