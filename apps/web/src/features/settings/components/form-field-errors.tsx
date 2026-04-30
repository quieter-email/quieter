type FormFieldError = { message?: string } | null | undefined;

export const FormFieldErrors = ({ errors }: { errors: FormFieldError[] }) =>
  errors.map((error) => {
    const message = error?.message ?? "An unknown error occurred.";

    return (
      <p className="text-sm text-destructive" key={message}>
        {message}
      </p>
    );
  });
