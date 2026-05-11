import { Module } from '@nestjs/common'
import { UsersService } from './application/users.service'
import { UsersRepository } from './infrastructure/users.repository'
import { UsersController } from './presentation/users.controller'

@Module({
	controllers: [UsersController],
	providers: [UsersRepository, UsersService],
	exports: [UsersRepository, UsersService],
})
export class UsersModule {}
