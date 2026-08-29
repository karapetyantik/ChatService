import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class AddMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  memberIds!: string[];
}
