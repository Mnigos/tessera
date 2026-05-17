import type { CreateSshPublicKeyInput } from '@repo/contracts'
import type { SshPublicKeyId } from '@repo/domain'
import { useState } from 'react'
import { useCreateSshPublicKeyMutation } from '../hooks/use-create-ssh-public-key.mutation'
import { useDeleteSshPublicKeyMutation } from '../hooks/use-delete-ssh-public-key.mutation'
import { CreateSshPublicKeyForm } from './create-ssh-public-key-form'
import { SshPublicKeysList } from './ssh-public-keys-list'

interface SshPublicKeysSectionProps {
	enabled: boolean
}

export function SshPublicKeysSection({
	enabled,
}: Readonly<SshPublicKeysSectionProps>) {
	const [deletingId, setDeletingId] = useState<SshPublicKeyId>()
	const createSshPublicKey = useCreateSshPublicKeyMutation()
	const deleteSshPublicKey = useDeleteSshPublicKeyMutation()

	function handleSubmit(input: CreateSshPublicKeyInput, form: HTMLFormElement) {
		createSshPublicKey.mutate(input, {
			onSuccess: () => form.reset(),
		})
	}

	function handleDelete(id: SshPublicKeyId) {
		setDeletingId(id)
		deleteSshPublicKey.mutate(
			{ id },
			{
				onSettled: () => setDeletingId(undefined),
			}
		)
	}

	return (
		<section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
			<SshPublicKeysList
				deletingId={deleteSshPublicKey.isPending ? deletingId : undefined}
				enabled={enabled}
				onDelete={handleDelete}
			/>
			<CreateSshPublicKeyForm
				isError={createSshPublicKey.isError}
				isPending={createSshPublicKey.isPending}
				onSubmit={handleSubmit}
			/>
		</section>
	)
}
