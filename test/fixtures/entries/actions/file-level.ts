'use server';

let lastEmail = '';

// Server Action: runs per request with the client's form data.
export async function subscribe(formData: FormData) {
  lastEmail = String(formData.get('email'));
}

export const rename = async (data: { name: string }) => {
  lastEmail = data.name;
};

// Not exported: not callable from the client, so it is a plain helper.
async function helper(data: { name: string }) {
  lastEmail = data.name;
}
