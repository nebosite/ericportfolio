import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from './HomePage';

describe('PixelWhimsy HomePage', () => {
  it('renders the logo and tagline without crashing', () => {
    render(<HomePage />);
    expect(screen.getByAltText('PixelWhimsy')).toBeInTheDocument();
    expect(screen.getByText(/paint tiny pictures/i)).toBeInTheDocument();
  });

  it('mounts the pixel canvas', () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});
