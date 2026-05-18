import type { CreateGpgPublicKeyInput } from '@repo/contracts'
import type { GpgPublicKeyId } from '@repo/domain'
import { useState } from 'react'
import { useCreateGpgPublicKeyMutation } from '../hooks/use-create-gpg-public-key.mutation'
import { useDeleteGpgPublicKeyMutation } from '../hooks/use-delete-gpg-public-key.mutation'
import { CreateGpgPublicKeyForm } from './create-gpg-public-key-form'
import { GpgPublicKeysList } from './gpg-public-keys-list'

interface GpgPublicKeysSectionProps {
	enabled: boolean
}

export function GpgPublicKeysSection({
	enabled,
}: Readonly<GpgPublicKeysSectionProps>) {
	const [deletingId, setDeletingId] = useState<GpgPublicKeyId>()
	const createGpgPublicKey = useCreateGpgPublicKeyMutation()
	const deleteGpgPublicKey = useDeleteGpgPublicKeyMutation()

	function handleSubmit(input: CreateGpgPublicKeyInput, form: HTMLFormElement) {
		createGpgPublicKey.mutate(input, {
			onSuccess: () => form.reset(),
		})
	}

	function handleDelete(id: GpgPublicKeyId) {
		setDeletingId(id)
		deleteGpgPublicKey.mutate(
			{ id },
			{
				onSettled: () => setDeletingId(undefined),
			}
		)
	}

	return (
		<section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
			<GpgPublicKeysList
				deletingId={deleteGpgPublicKey.isPending ? deletingId : undefined}
				enabled={enabled}
				onDelete={handleDelete}
			/>
			<CreateGpgPublicKeyForm
				isError={createGpgPublicKey.isError}
				isPending={createGpgPublicKey.isPending}
				onSubmit={handleSubmit}
			/>
		</section>
	)
}
