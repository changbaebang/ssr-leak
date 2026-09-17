let lastEmail = '';

export function SignupForm() {
  async function subscribe(formData: FormData) {
    'use server';
    lastEmail = String(formData.get('email'));
  }
  return <form action={subscribe} />;
}

// Same shape without the directive: a plain function whose argument may or may not be a request.
export async function plain(formData: FormData) {
  lastEmail = String(formData.get('email'));
}
