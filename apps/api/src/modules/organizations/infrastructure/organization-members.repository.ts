import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, eq, member, user } from '@repo/db'
import type { OrganizationId, OrganizationMemberId } from '@repo/domain'
import type { OrganizationMemberView } from '../domain/organization-member'

interface OrganizationParams {
	organizationId: OrganizationId
}

interface MemberParams extends OrganizationParams {
	memberId: OrganizationMemberId
}

const MEMBER_COLUMNS = {
	id: member.id,
	role: member.role,
	createdAt: member.createdAt,
	user: {
		id: user.id,
		username: user.username,
		name: user.name,
		image: user.image,
	},
}

@Injectable()
export class OrganizationMembersRepository {
	constructor(private readonly db: Database) {}

	async listMembers({
		organizationId,
	}: OrganizationParams): Promise<OrganizationMemberView[]> {
		return await this.db
			.select(MEMBER_COLUMNS)
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, organizationId))
			.orderBy(asc(member.createdAt), asc(member.id))
	}

	async findMember({
		memberId,
		organizationId,
	}: MemberParams): Promise<OrganizationMemberView | undefined> {
		const [row] = await this.db
			.select(MEMBER_COLUMNS)
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(
				and(eq(member.id, memberId), eq(member.organizationId, organizationId))
			)
			.limit(1)

		return row
	}
}
