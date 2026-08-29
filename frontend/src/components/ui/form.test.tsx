import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form';

// The shadcn parts read useFormField(), which reads useFormContext(). Outside a
// <Form> that returns null and the old code destructured it, crashing at render.
// These parts are Form-coupled by design, so the contract is an explicit,
// descriptive throw — never the cryptic "Cannot destructure property 'formState'
// of null" TypeError.
describe('ui/form useFormField guard', () => {
  it('throws a descriptive error (not a destructure TypeError) outside <Form>', () => {
    // Silence React's error-boundary console noise for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<FormMessage>hi</FormMessage>)).toThrow(
      /useFormField must be used within <Form>/,
    );
    spy.mockRestore();
  });

  it('renders normally when wrapped in <Form> and <FormField>', () => {
    function Harness() {
      const form = useForm({ defaultValues: { email: '' } });
      return (
        <Form {...form}>
          <FormField
            name="email"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      );
    }
    expect(() => render(<Harness />)).not.toThrow();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });
});
