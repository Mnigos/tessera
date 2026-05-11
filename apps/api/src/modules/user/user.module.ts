import { Module } from '@nestjs/common'
import { UserService } from './application/user.service'
import { UserRepository } from './infrastructure/user.repository'
import { UserController } from './presentation/user.controller'

@Module({
	controllers: [UserController],
	providers: [UserService, UserRepository],
	exports: [UserService],
})
export class UserModule {}
