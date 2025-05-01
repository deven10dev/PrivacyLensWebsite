import { render, screen } from '@testing-library/react';
// import PrivacyLensApp from './App';
import App from './App';

test('renders learn react link', () => {
  // render(<PrivacyLensApp />);
  render(<App />);
  const linkElement = screen.getByText(/learn react/i);
  expect(linkElement).toBeInTheDocument();
});
