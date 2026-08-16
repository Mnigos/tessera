import { OrganizationsModule } from '@modules/organizations'
import { RepositoriesModule } from '@modules/repositories'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { HandlesService } from './application/handles.service'
import { HandlesController } from './presentation/handles.controller'

@Module({
	imports: [OrganizationsModule, RepositoriesModule, UserModule],
	controllers: [HandlesController],
	providers: [HandlesService],
})
export class HandlesModule {}
